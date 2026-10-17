<!--
DRAFT for the AWS Builder Center article. NOT PUBLISHED. The hackathon requires the article to be
published on Builder Center before the deadline (2026-10-23 23:59 PT); publishing is done by the author.

How to read this draft:
- Plain text is a fact about the code in this repository (checked at the time of writing).
- [MEASURE] marks a number that must be measured on AWS before it is stated. Do not publish with any
  [MEASURE] or [TODO] left in, and do not replace one with an estimate.
- Written in English because the hackathon is international; translate if the author prefers.
Tags to add on Builder Center: #strands-decider-2b  #tool-selection
-->

# Before You Take the Photo: letting Strands Decider 2B choose the one next step

*An agent that helps you tidy one thing (a brow or your bangs) before an ID-style photo, and lets you
compare before and after. Built on AWS with Amazon Bedrock and Strands Decider 2B.*

## What the agent does

You open the app on your phone, say what you want looked at (brows, bangs, or "just look"), and take a
test photo. The agent suggests **one** small, reversible thing to try. You try it, take a second photo
from the same spot, and the app puts the two side by side. **You** choose "I prefer before", "I prefer
after" or "I can't tell", and you can stop at any moment. Choosing "before" counts as a successful
session. A session allows at most two changes.

It is not a beauty scorer. It does not edit images, rate faces, guess gender, or promise that a photo
will be accepted anywhere.

## The decision handed to Strands Decider 2B

After Amazon Bedrock (Nova Lite) has looked at the photo, the agent faces one question:

> Given what the person asked for and what we can currently see, which support should we use next?

The options (a typed `choice` question, each with a description):

| Option | When it is right |
|---|---|
| `grooming_tip` | There is evidence in the photo, and it respects what the person ruled out: suggest one grooming step |
| `capture_setup_tip` | The conditions make it hard to see (backlight, position, a big lighting change): fix the setup first |
| `clarify` | The evidence is weak or the request is unclear or contradictory: ask |
| `offer_finish` | The limit is reached or the person wants to stop: offer to finish |

This is **tool selection**: the option the Decider picks decides which tool actually runs. Only the
selected tool's handler is called. Choosing `clarify` asks a question; choosing `grooming_tip` calls
Bedrock a second time to write one concrete suggestion. The Decider takes text only, so Bedrock first
turns the photo into a short list of observations (what is visible, what is uncertain, lighting,
framing) and only those facts reach the Decider.

## Why the model's choice is not the last word

Two rules sit between the Decider and the tools, in ordinary code. This is the part of the pattern I
would reuse in any agent:

- **Guards can overrule the choice and say why.** The user's "do not touch" choices, the two-change
  limit and "do not judge what cannot be seen" are checked in code. Every override is recorded.
- **A failed decision is never papered over.** If the Decider or Bedrock fails, the job fails and the
  session returns to where the person was; no default answer is invented.

What we saw when we tried it. We ran the Decider on a development Mac (CPU) with five hand-written
states. This is a smoke test, not an evaluation:

- In a state that said "do not touch the brows", the Decider still chose `grooming_tip` (probability
  0.57, confidence 0.42). The guard replaced it with `clarify` and recorded `restriction`. That is exactly
  the case the guards exist for.
- Sensible choices had confidences around 0.69, so a fixed "reject below 0.8" rule would have thrown
  them away. We left the confidence guard off until it can be calibrated on evaluation data.
- A call took about 4.5 s on that CPU, loading took about 80 s and about 5.7 GB of memory.

[MEASURE] Decider latency and peak memory on the Fargate task (4 vCPU / 16 GB).
[MEASURE] Accuracy and handling of low-confidence cases on an evaluation set (consented photos only).
[MEASURE] Latency and cost against an LLM making the same decision, if we compare at all.

## Architecture

Amazon CloudFront and S3 serve the React app; Amazon Cognito (authorization code with PKCE, invitation
only) signs people in; Amazon API Gateway and AWS Lambda accept requests; photos go to a private,
short-lived Amazon S3 bucket by signed upload; Amazon SQS carries only a job id to an AWS Fargate
worker that runs Bedrock and the Decider; Amazon DynamoDB keeps session state, never images.

Privacy decisions that shaped the design: photos are shown from the browser's memory and never stored
in the browser; the cloud copy is deleted after processing (and within 24 hours if something fails);
logs and decision records contain ids, option names and numbers, never a photo, the person's words or
model text; the person is told about cloud analysis and agrees before the first photo.

[MEASURE] Confirm on AWS that photos are really gone after success, failure and cancellation (task T083); the worker deletes them in every outcome and an S3 lifecycle rule is the 24-hour backstop, but neither has run on AWS yet.
[TODO] Add the final architecture diagram (use `docs/architecture/diagrams/system-overview.png`).
[TODO] State what is actually deployed at submission time. At the time of writing nothing has been
deployed to AWS and the worker has only run locally, with Bedrock mocked in tests.

## The reusable pattern

The pattern is a small package (`decision_pattern`) with a typed question, the wiring that puts the
decision in the agent's path, and a note on how to use it, in the public repository:
`apps/worker/src/photoprep_worker/decision_pattern/` and `docs/decision-pattern.md`. It does not import
anything else from the app, a test enforces that, and it ships a runnable example in a different domain
(routing support requests). Copy the directory and pass your own question, guards and handlers.

## What I would do next

[TODO] Calibrate the confidence guard on an evaluation set; measure on Fargate; run the full flow on AWS.

## Links

- Code: [TODO public repository URL] (MIT)
- Demo video (under 3 minutes): [TODO video URL]

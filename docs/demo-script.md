# Demo video script (under 3 minutes)

**Status: script only. Not recorded, not published.** The author records and uploads the video
(YouTube, Vimeo, Facebook Video or Youku, public). Hard limit: **under 3:00** (aim for 2:40).

## Rules from the official terms to respect

- The video must show **the agent and its Strands Decider 2B decision working**.
- It must work **on AWS**. The mock mode of the frontend is not enough: at least the decision scenes
  must come from the deployed stack (the worker running on Fargate with Bedrock). A replay may be used
  only as a clearly labelled extra, never as the proof of the Decider's decision.
- No third-party trademarks and no copyrighted music or other material without permission. Use no
  background music, or music you have the rights to. Keep other brands' logos out of the frame.
- Use your own face or a consenting person. Show nothing that identifies anyone else.

## Before recording (checklist)

- [ ] The stack is deployed and the worker is **started and warmed** (model loaded; the first request after
      a cold start is slow and the app says so). Budget cap and shutdown schedule are in place.
- [ ] Frontend points at the real API (not mock mode): the yellow "モック動作中" banner must **not** appear.
- [ ] You can export decision records: `uv run python -m tools.export_decisions --table <TABLE>` in `apps/worker`.
- [ ] Two sessions prepared: A (normal) and B (the "do not touch the brows" restriction), same photo.
- [ ] Screen recording at phone width; captions on; no personal data, tokens or account ids visible.

## Scenes

| Time | Show | Say (captions in English) |
|---|---|---|
| 0:00-0:15 | App home on a phone | "Before an ID-style photo, I want to tidy one thing and compare. This agent suggests one step, I choose." |
| 0:15-0:40 | Consult screen: choose brows, tick the cloud-analysis consent; take the first photo | "It tells me up front the photo is analysed in the cloud and deleted afterwards. Bedrock looks at the photo; the Decider never sees the image, only the facts." |
| 0:40-1:10 | **Decision records for session A** (exported rows next to the suggestion on screen) | "Strands Decider 2B answers one typed question: which support next? Four options. It picked grooming_tip, with these probabilities. Only that tool ran." |
| 1:10-1:40 | Try it, retake, compare screen, choose | "I tidy up, take a second photo, and compare. Whatever I choose, including 'before', is a good outcome." |
| 1:40-2:15 | **Session B**: same photo, but "do not touch the brows". Show the record: decider_choice vs selected, guard_override = restriction | "The model still wanted a brow tip. The guard overruled it and recorded why. The model advises; ordinary code enforces the rules." |
| 2:15-2:35 | The pattern folder and `docs/decision-pattern.md` | "The pattern is a small, standalone package: a typed question, the wiring, and a note. Copy it into your own agent." |
| 2:35-2:50 | Architecture diagram | "CloudFront, Cognito, API Gateway, Lambda, SQS, Fargate, Bedrock, DynamoDB. Photos never stay in the browser or the logs." |

## Do not say (unless measured on AWS first)

Any speed, memory, accuracy or cost number for Fargate or Bedrock; "production ready"; any claim about
passing a government photo standard. The development-Mac numbers (about 4.5 s per decision) may be
quoted only as "on my laptop CPU".

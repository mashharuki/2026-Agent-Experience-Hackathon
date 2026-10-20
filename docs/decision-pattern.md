# Decision pattern: typed question → guarded choice → the one chosen tool runs

**Tag: `#tool-selection`** · Built on Strands Decider 2B · Code: [`apps/worker/src/photoprep_worker/decision_pattern/`](../apps/worker/src/photoprep_worker/decision_pattern/) · License: MIT

A reusable way to let Strands Decider 2B make a real decision in an agent: it picks **one tool**
out of a fixed set, ordinary code can overrule it, and only the selected tool runs.

The app now uses **v4 eligibility**: code computes executable candidates first. With two or
more candidates, the adapter sends only those options to Decider. With one, the binding
executes that code decision without a model call. The old unconstrained example below
remains supported; no dummy model scores are created for code decisions.

```text
state text ──▶ Decider (typed choice question) ──▶ guards ──▶ handlers[selected]() ──▶ Decision
                    options + descriptions          override                          (what was chosen,
                    probabilities + confidence      with a reason                      overruled, and run)
```

## The three parts

| Part | What it is | Where |
|---|---|---|
| **Typed question and option set** | One question and 2+ named options, each with a plain-language description of when it is right. The descriptions are sent to the model. | `question.py` (`TypedQuestion`) |
| **Wiring into the agent's path** | `run_decision` asks the Decider, applies guards, then calls the handler of the selected option. Every option must have a handler; no other handler runs. | `binding.py` (`run_decision`), `guards.py`, `decider.py` |
| **Note on what it does and how to use it** | This page, and a runnable example. | `example.py`, below |

## What it does

1. `StrandsDecider.choose(state)` asks the model a typed **choice** question and returns the option
   probabilities and a confidence (call shape verified against `strands-decider 0.1.0`).
2. Each **guard** is `(choice, context) -> Override | None`. The first override wins and carries a
   short reason code. Use guards for rules that must hold whatever the model says.
3. `run_decision` runs `handlers[selected]()` and returns a `Decision` with the model's choice, the
   option that actually ran, the override reason, the probabilities, the confidence and the result.
4. If the Decider fails, the error propagates: nothing runs on a guess and no default is chosen.

Pass `eligibility=Eligibility(("ask_user", "escalate"), "payment_data")` to constrain the
example's options. The configured handlers still cover the full question. Invalid candidate
sets, out-of-set model answers and guards that reintroduce excluded actions fail before any
handler runs. A singleton records `decision_source="policy"`, `decider_choice=None`,
`probabilities=None`, `confidence=None`, its candidate and policy reason. Model scores are
conditional on the actual candidate set, so confidence across different sets is not directly
comparable. Custom deciders used with eligibility accept `choose(state, *, question=...)`.

## How to use it

```python
from decision_pattern import (
    Override, StrandsDecider, TypedQuestion, load_engine, run_decision,
)

QUESTION = TypedQuestion(
    name="route_request", version="v1",
    instructions="Which tool should handle this support request?",
    options={
        "search_docs": "the answer is probably in the documentation",
        "ask_user":    "the request is unclear or missing details; ask the user",
        "escalate":    "the user is upset, or the request involves money or account access",
    },
)

def payment_data_always_escalates(choice, request):          # a rule the model cannot break
    if request.contains_payment_data and choice.selected != "escalate":
        return Override("escalate", "payment_data")

decider = StrandsDecider(load_engine(device="cpu"), QUESTION)  # load once, reuse

decision = run_decision(
    decider=decider, question=QUESTION, state=f"request: {request.text}",
    guards=[payment_data_always_escalates], context=request,
    handlers={"search_docs": search_docs, "ask_user": ask_user, "escalate": escalate},
)
decision.selected, decision.decider_choice, decision.override_reason, decision.result
```

A runnable version with a scripted stand-in for the model is in
[`example.py`](../apps/worker/src/photoprep_worker/decision_pattern/example.py)
(`PYTHONPATH=src uv run python -m photoprep_worker.decision_pattern.example` in `apps/worker`); the tests run it
and check that exactly the chosen tool ran and that a guard can take over.

## How this app uses it

The "next support" question in [`decider.py`](../apps/worker/src/photoprep_worker/decider.py) has four
options: `grooming_tip`, `capture_setup_tip`, `clarify`, `offer_finish`. The Decider only sees text
facts (the photo is observed by Bedrock first). [`support_policy.py`](../apps/worker/src/photoprep_worker/support_policy.py)
excludes unavailable actions: exhausted quotas, prohibited targets, blank observation evidence,
unknown/poor capture conditions and repeated clarification. Terminal-only states skip Decider.
The guards in
[`guards.py`](../apps/worker/src/photoprep_worker/guards.py) enforce the user's "do not touch"
choices, the two-change limit and "do not judge what cannot be seen". Each decision is recorded
(`DecisionRecord`: option names, probabilities, confidence, override reason and which models ran, never
an image or the user's words).

## What we observed (and what we did not measure)

Measured on a development Mac (CPU, `strands-decider 0.1.0`) with five hand-written text states, so
this is a smoke test, not an evaluation:

- A call takes about 4.5 s; loading takes about 80 s and about 5.7 GB of memory.
- With a state that said "do not touch the brows", the Decider still chose `grooming_tip`
  (probability 0.57). The guard replaced it with `clarify` and recorded `restriction`.
- Sensible choices had confidences of 0.69 (a correct `capture_setup_tip`) and 0.69 (a correct
  `clarify`). These warn against assuming a universal threshold of 0.8. The current confidence
  guard applies only to `grooming_tip`, so it would not reject these two examples. It is disabled
  by default until evaluated for that action.

Not measured: speed and memory on Fargate, accuracy on real data, any comparison with an LLM, cost.

The [local evaluation plan](../specs/001-pre-photo-grooming-assist/model-evaluation-plan.md) adds
synthetic cases, rules/v1/v2 comparisons, and aligned decision inputs. It was implemented and
run on 2026-10-20: **275 real local judgments**, no AWS/Bedrock calls. On 30 fixed synthetic
holdout scenes repeated three times, both state renderers achieved 57/90 raw and 87/90 guarded
allowed-set matches, with zero final constraint violations. The rules baseline achieved 90/90
guarded matches. No selection improved, so that initial experiment retained **v1**, threshold **0**.
This small, single-AI-authored set does not establish general accuracy or model superiority.
See the [conditions, failures and limitations](reviews/2026-10-20-local-model-evaluation.md).

The reusable adapter and binding now reject malformed score keys, non-finite/out-of-range
values, probability sums outside 1±0.01 and a selected option below the maximum probability
(ties allowed). They do not normalize or invent answers. Invalid outputs execute no handler.
Production builds state and guard context from one immutable `DecisionInputs`; v1 intentionally
keeps its original rendering. AWS validation remains a separate, unperformed stage.

The subsequent eligibility change uses separate frozen synthetic sets, preserving those historical
results. See the [eligibility implementation plan](../specs/001-pre-photo-grooming-assist/eligibility-plan.md).
Policy decisions and actual model decisions are reported separately; better guarded outcomes
are not evidence that the underlying model became more capable. Independent human label review
and real-photo quality evaluation remain outstanding.

The v3 wording candidate failed the no-regression gate (supported grooming fell from 6/6
to 4/6). The v4 question retains the original wording and uses the same code eligibility and
expanded state. The first new set is now regression data; a separate synthetic state matrix
is frozen before v4 validation. These results remain system checks, not broad model accuracy.

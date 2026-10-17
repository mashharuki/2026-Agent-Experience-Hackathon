# Third-party notices

This project's own code is MIT-licensed (see [LICENSE](LICENSE)). It depends on the following; the
full license texts are in each package. Versions are from the lock files at the time of writing
(2026-10-17). This is a good-faith summary, not legal advice.

## Models (not redistributed in this repository)

| Model | License | How it is used |
|---|---|---|
| `StrandsAgents/strands-decider-2B-qwen3.5-v1-2610` (LoRA adapter + readout head) | Apache-2.0 | Downloaded at image build time by `apps/worker/scripts/prefetch_models.py` at a pinned revision |
| `Qwen/Qwen3.5-2B-Base` | Apache-2.0 | The base weights of the Decider, downloaded the same way |
| Amazon Nova Lite (`amazon.nova-lite-v1:0`) | AWS service terms | Called through Amazon Bedrock; no weights are included |

## Main libraries

| Area | Package | License |
|---|---|---|
| Worker | strands-decider 0.1.0 | Apache-2.0 |
| Worker | PyTorch 2.14.1 (CPU build) | BSD-3-Clause and others (see the package) |
| Worker | Transformers 5.20.1, boto3 1.43, Hugging Face Hub | Apache-2.0 |
| Worker | Pydantic 2.14 | MIT |
| Worker | Pillow 13.0 | MIT-CMU |
| API | Connexion 3.3.0 | Apache-2.0 |
| API | Flask 3.1, Starlette 1.8, Werkzeug 3.1 | BSD-3-Clause |
| API | Mangum 0.22 | MIT |
| Frontend | React 19, Material UI, Emotion, TanStack Query, Vite | MIT |
| Frontend | react-transition-group | BSD-3-Clause |
| Tooling | Orval, Biome, Vitest, Testing Library | MIT |
| Tooling (tests) | moto | Apache-2.0 |

**React Bits is not used.** Its MIT + Commons Clause license restricts redistributing the
components, which conflicts with the hackathon's requirement that the public repository be under an
approved OSI license (see `specs/001-pre-photo-grooming-assist/research.md`, R-005).

## Diagrams

The architecture diagrams in `docs/architecture/diagrams/` use the AWS Architecture Icons. AWS and the
AWS logo are trademarks of Amazon.com, Inc. or its affiliates; they are used only to describe the AWS
services this project runs on and do not imply endorsement.

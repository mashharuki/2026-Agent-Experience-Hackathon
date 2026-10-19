# Repository Guidelines

## Project Structure & Module Organization

This AWS hackathon project helps a person try one grooming adjustment before a photo and compare the result.

- `apps/frontend/`: React/Vite SPA, MUI screens, TanStack Query, bilingual UI, mock API and PWA.
- `apps/api/`: Python Connexion/Flask API, Lambda adapter, operations handlers and pytest tests.
- `apps/worker/`: Python SQS worker, Bedrock observation, Decider selection, guards and Docker image.
- `apps/cdk/`: TypeScript AWS CDK infrastructure and Jest assertions.
- `packages/api-spec/openapi.yaml`: authoritative API contract; `packages/photoprep-common/`: shared Python persistence, states and logging.
- `specs/001-pre-photo-grooming-assist/`: requirements, plans, tasks and validation scenarios. `docs/architecture/` contains AWS diagrams and cost assumptions.

## Specification Workflow

Follow `.specify/memory/constitution.md` and `.agents/skills/speckit-*/`. Read `docs/tech-stack.md`, the feature spec and `remediation-plan.md` before changes. Reference the stack in Technical Context. Update requirements, contracts, generated clients and tasks together. Keep implemented behavior distinct from AWS validation and model-quality evidence.

## Build, Test, and Development Commands

Use `pnpm@10.32.1`, Python 3.12 and uv.

- `pnpm install --frozen-lockfile`: install JavaScript dependencies.
- `pnpm --filter frontend dev` / `build`: run Vite / type-check and build.
- `pnpm --filter frontend test` / `test:e2e`: run Vitest / Playwright with synthetic mock data.
- `pnpm --filter api-spec check`: validate OpenAPI and Connexion loading.
- `pnpm --filter frontend api:generate`: regenerate Orval clients; never edit generated code.
- In `apps/api/` and `apps/worker/`: `uv sync --frozen`, `uv run pytest`, `uv run ruff check .`.
- `pnpm --filter cdk test` / `build`: check infrastructure and TypeScript.
- `pnpm exec biome check .`, `pnpm --filter frontend lint`, `pnpm check:quality`, `git diff --check`: non-mutating checks. `pnpm format` writes formatting changes.

## Coding Style & Testing

Follow Biome for JS/TS and Ruff for Python. Use descriptive names; preserve `grooming_tip`, `capture_setup_tip`, `clarify`, and `offer_finish`. Test observable behavior, ownership, restrictions, atomic acceptance, cancellation and deletion failures. Run shared Store contracts against memory and moto. Evaluate real model quality separately from deterministic fake-model tests; no coverage percentage is configured.

## Commit & Pull Request Guidelines

Use specific, action-oriented subjects. PRs should explain behavior, validation and limitations, link relevant issues and include screenshots for UI changes. `.github/workflows/ci.yml` checks contracts, code generation, quality, tests and mock browser flows.

## Security & Operations

Keep Cognito authentication and server ownership checks on every API. Apply restrictions and limits in code. Never commit credentials, personal face photos or observation text. Do not log user content. Explain cloud processing and short-lived observation reuse before capture. Ended sessions must reject new work and ignore late results. Cloud deployment and paid model checks require the documented budget and shutdown procedures.

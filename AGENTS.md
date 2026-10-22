# Repository Guidelines

## Project Structure & Module Organization

The current product is a human-versus-AI Snipe dinghy game, specified in `specs/002-snipe-ai-regatta/`. Local practice is implemented; real-model racing and the new cloud services are pending. Existing photo-assistant code remains reusable legacy code; its AWS deployment was deleted on 2026-10-21.

- `apps/regatta-web/`: React/MUI/Three.js local practice and replay; the opponent currently uses explicit fixed rules.
- `packages/sailing-sim/`: deterministic 30Hz physics, seeded wind, evolving gusts, tactics and Vitest tests. Keep weather on simulation time and record physics/wind versions.

- `apps/frontend/`: React/Vite SPA, MUI screens, TanStack Query, bilingual UI, mock API and PWA.
- `apps/api/`: Python Connexion/Flask API, Lambda adapter, operations handlers and pytest tests.
- `apps/worker/`: Python SQS worker, Bedrock observation, Decider selection, guards and Docker image.
- `apps/cdk/`: TypeScript AWS CDK infrastructure and Jest assertions.
- `packages/api-spec/openapi.yaml`: authoritative API contract; `packages/photoprep-common/`: shared Python persistence, states and logging.
- `specs/001-pre-photo-grooming-assist/`: legacy specifications and evidence. `docs/architecture/`: diagrams and cost assumptions.

## Specification Workflow

Follow `.specify/memory/constitution.md` and `.agents/skills/speckit-*/`. Read `docs/tech-stack.md` and the active spec/plan/research; for legacy fixes, read `001/remediation-plan.md`. Reference the stack in Technical Context. Promote draft OpenAPI before generation. Synchronize requirements, contracts, clients and tasks. Distinguish implementation, AWS evidence and model quality.

## Build, Test, and Development Commands

Use `pnpm@10.32.1`, Python 3.12 and uv.

- `pnpm install --frozen-lockfile`: install JavaScript dependencies.
- `pnpm --filter regatta-web dev` / `build` / `test`: run the sailing practice on port 5174, build it or test its runtime.
- `pnpm --filter sailing-sim test` / `build`: test the sailing/weather model or type-check it.
- `pnpm --filter frontend dev` / `build`: run Vite / type-check and build.
- `pnpm --filter frontend test` / `test:e2e`: run Vitest / Playwright with synthetic mock data.
- `pnpm --filter api-spec check`: validate OpenAPI and Connexion loading.
- `pnpm --filter frontend api:generate`: regenerate Orval clients; never edit generated code.
- In `apps/api/` and `apps/worker/`: `uv sync --frozen`, `uv run pytest`, `uv run ruff check .`.
- `pnpm --filter cdk test` / `build`: check infrastructure and TypeScript.
- `pnpm exec biome check .`, `pnpm --filter frontend lint`, `pnpm check:quality`, `git diff --check`: non-mutating checks. `pnpm format` writes formatting changes.

## Coding Style & Testing

Follow Biome for JS/TS and Ruff for Python. Preserve legacy enums. Separate physics, rendering and decisions; never block rendering on inference or expose future wind. Test ownership, atomic acceptance, expiry, cancellation and deletion. Run Store contracts against memory/moto. Separate model evaluation from fake-model tests; no coverage percentage is configured.

## Commit & Pull Request Guidelines

Use action-oriented subjects. PRs explain behavior, validation and limitations, link issues and show UI screenshots. CI checks contracts, generation, quality, tests and mock browser flows.

## Security & Operations

Require Cognito and ownership checks on every cloud API. Enforce limits in code. Never commit credentials or user content. Ended races/sessions reject new work and late results. Deployment requires latency and remaining-budget checks: $30 total and 30 worker-hours do not reset. Preserve legacy code and evidence until migration is accepted.

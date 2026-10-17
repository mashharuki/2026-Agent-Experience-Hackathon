# Repository Guidelines

## Project Structure & Module Organization

This repository is an early-stage AWS Agent Experience Hackathon project: a photo-preparation assistant that helps users try one grooming adjustment and compare results.

- `README.md` links to the hackathon.
- `docs/mvp.md` describes the proposed experience, architecture, scope, and validation scenarios. Read it before implementation; distinguish adopted direction from provisional details.
- `apps/frontend/` contains the React/Vite scaffold; `apps/cdk/` contains CDK infrastructure and test scaffolds.
- `packages/api-spec/` and `packages/shared/` are placeholder workspace packages.
- `docs/architecture/` contains the architecture baseline, cost estimates, and editable draw.io diagrams with AWS icons. API and Python worker applications are planned, not implemented.

## Specification Workflow

Use `.agents/skills/speckit-*/` and `.specify/` templates in the sequence documented in `README.md`. Follow the ratified constitution in `.specify/memory/constitution.md`. Distinguish architecture decisions from unverified performance assumptions and provisional MVP requirements.

Read [the technology stack](docs/tech-stack.md) before Spec Kit planning, task generation, implementation, or analysis. Reference it in each plan's Technical Context; turn pending checks into explicit tasks. Preserve adopted choices, keep recommendations distinct from verified decisions, and update the table when choices or installation status change. Keep OpenAPI YAML authoritative and regenerate clients instead of editing generated code.

## Build, Test, and Development Commands

Use the declared package manager, `pnpm@10.32.1`.

- `pnpm install`: install declared dependencies.
- `pnpm format`: format supported files with Biome, writing changes.
- `pnpm check`: run Biome checks with automatic fixes; review the resulting diff.
- `pnpm exec biome check .`: run checks without writing changes.
- `pnpm knip`: detect unused files, exports, and dependencies using `knip.json`.
- `pnpm jscpd`: detect duplication in `apps/` and `packages/`; write reports to ignored `report/`.
- `pnpm check:quality`: run Knip, then jscpd if Knip passes; neither applies code fixes.
- `git diff --check`: detect whitespace errors in changes.
- `pnpm --filter frontend dev`: start Vite locally.
- `pnpm --filter frontend build`: type-check and build the SPA.
- `pnpm --filter cdk test`: run the current Jest/CDK tests.
- `pnpm --filter cdk cdk synth`: synthesize infrastructure locally.

Turborepo is installed, but root task orchestration is not configured. Vite handles frontend builds; Turbopack is not installed.

## Coding Style & Naming Conventions

Follow `biome.json`: space indentation, double quotes in JavaScript, recommended lint rules, and organized imports. Let Biome determine formatting for supported files. Use descriptive module names and preserve documented decision identifiers such as `grooming_tip`, `capture_setup_tip`, `clarify`, and `offer_finish`.

## Testing Guidelines

CDK uses Jest with `test/*.test.ts`; its existing test is only a scaffold. No coverage threshold is configured. Document additional test runners when introduced.

Prioritize the scenarios in `docs/mvp.md`: missing images, explicit user restrictions, uncertain observations, changed lighting, and the two-adjustment limit. Evaluate model decisions separately from deterministic application behavior. Keep evaluation data separate from development examples.

## Commit & Pull Request Guidelines

History contains brief messages such as `init`, `update`, and `ベースを作成`; no formal convention is established. Write specific, action-oriented commit subjects. PRs should describe the change, validation performed, relevant issues, and remaining limitations. Include screenshots for UI changes.

## Architecture & Configuration

The proposed design assigns observation and explanation to Bedrock, support selection to Decider, and explicit restrictions and termination to ordinary code. Preserve user choice. Never commit credentials or personal face photos; document configuration with placeholder values. Explain cloud image processing before capture.

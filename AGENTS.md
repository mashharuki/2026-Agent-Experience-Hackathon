# Repository Guidelines

## Project Structure & Module Organization

This repository is an early-stage AWS Agent Experience Hackathon project: a photo-preparation assistant that helps users try one grooming adjustment and compare results.

- `README.md` links to the hackathon.
- `docs/mvp.md` describes the proposed experience, architecture, scope, and validation scenarios. Read it before implementation; distinguish adopted direction from provisional details.
- `pnpm-workspace.yaml` declares `apps/*` and `packages/*`. These directories are not yet populated; place applications and reusable modules there when implementation begins.
- No application source, tests, or asset directories exist yet.

## Specification Workflow

Use the Codex skills in `.agents/skills/speckit-*/` with the shared `.specify/` templates. Follow the sequence in `README.md`: principles, specification, clarification, plan, tasks, analysis, implementation. The constitution is initially an unfilled template; do not treat placeholders or provisional MVP details as agreed requirements.

## Build, Test, and Development Commands

Use the declared package manager, `pnpm@10.32.1`.

- `pnpm install`: install declared dependencies.
- `pnpm format`: format supported files with Biome, writing changes.
- `pnpm check`: run Biome checks with automatic fixes; review the resulting diff.
- `pnpm exec biome check .`: run checks without writing changes.
- `git diff --check`: detect whitespace errors in changes.

There are no working application build or test commands yet. Existing setup/start/stop scripts reference absent shell files; x402, facilitator, and Cloudflare commands reference absent packages. Treat these as scaffold remnants, not supported workflows. Update scripts and this guide when adding runnable components.

## Coding Style & Naming Conventions

Follow `biome.json`: space indentation, double quotes in JavaScript, recommended lint rules, and organized imports. Let Biome determine formatting for supported files. Use descriptive module names and preserve documented decision identifiers such as `grooming_tip`, `capture_setup_tip`, `clarify`, and `offer_finish`.

## Testing Guidelines

No testing framework, naming convention, or coverage threshold is configured. When adding executable code, document its test runner and command. Use `*.test.<extension>` for new unit tests unless the chosen framework requires otherwise.

Prioritize the scenarios in `docs/mvp.md`: missing images, explicit user restrictions, uncertain observations, changed lighting, and the two-adjustment limit. Evaluate model decisions separately from deterministic application behavior. Keep evaluation data separate from development examples.

## Commit & Pull Request Guidelines

History contains brief messages such as `init`, `update`, and `ベースを作成`; no formal convention is established. Write specific, action-oriented commit subjects. PRs should describe the change, validation performed, relevant issues, and remaining limitations. Include screenshots for UI changes.

## Architecture & Configuration

The proposed design assigns observation and explanation to Bedrock, support selection to Decider, and explicit restrictions and termination to ordinary code. Preserve user choice. Never commit credentials or personal face photos; document configuration with placeholder values. Explain cloud image processing before capture.

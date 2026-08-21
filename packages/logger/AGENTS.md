# packages/logger — Shared Logger

Thin shared logger for the monorepo. Use this instead of console.log.

## Rules

- Use this logger instead of `console.log` / `console.debug`. Diagnostics that must not corrupt structured output go to stderr (`console.error`) — see studio's route contracts in `apps/studio/AGENTS.md`.
- No domain vocabulary — no CONTEXT.md (infra, per ADR-0010).

## Pointer to root

Cross-cutting (commands, conventions, commit style) → root `AGENTS.md`.

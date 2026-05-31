# Contributing to Lockstep

Thanks for taking a look. Lockstep is a small, deliberately-scoped tool, so the
bar is "keep it sharp," not "add everything."

## Development setup

```bash
npm install
npm test            # vitest unit tests (offline, no API keys needed)
npm run dev -- run  # run the CLI from source via tsx
npm run build       # type-check + compile to dist/
```

Tests are fully offline — the cost, diff, compare, report, judge-parser, env,
and registry suites never hit a network. Please keep it that way: anything that
needs a real API call belongs behind a manual check, not the test suite.

## Adding a provider

This is the most common contribution and is intended to be small:

1. Add `core/providers/<name>.ts` implementing the `Provider` interface
   (`core/providers/types.ts`).
2. Register it in `core/providers/registry.ts` (one line in `PROVIDER_FACTORIES`).

That's it — `config.ts` validates the `provider` field against the registry, so
no schema changes are needed. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
design rationale.

## Pull request checklist

- `npm run build` is clean (no TypeScript errors).
- `npm test` passes.
- New behavior has a unit test.
- No secrets, `.env` files, or generated `.lockstep/` runs committed.

## Scope

Keep it tight. Cloud/hosted reports, CI-gate actions, and a public gallery are
explicitly out of scope for this repo — it's a local-first tool. If in doubt,
open an issue before a large PR.

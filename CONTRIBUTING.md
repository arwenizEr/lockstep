# Contributing to Lockstep

Thank you for your interest. Lockstep is a small, deliberately-scoped tool, so the
bar for contributions is "keep it sharp and well-tested" rather than "add
everything."

## Development setup

```bash
npm install
npm test            # offline vitest suite — no API key required
npm run dev -- run  # run the CLI from source via tsx
npm run build       # type-check and compile to dist/
```

The test suite is fully offline: the pure modules are tested directly, the
provider adapters are exercised through an injectable client/`fetch`, and the
keyless `mock` provider drives the runner end-to-end. Please keep it that way —
anything that requires a live API call belongs in a manual check, not in the
automated suite.

## Adding a provider

This is the most common contribution and is intentionally small:

1. Add `core/providers/<name>.ts` implementing the `Provider` interface defined in
   `core/providers/types.ts`.
2. Register it in `core/providers/registry.ts` — one line in `PROVIDER_FACTORIES`.

No schema changes are needed: `config.ts` validates the `provider` field against
the registry. See [ARCHITECTURE.md](ARCHITECTURE.md) for the rationale, and
`core/providers/mock.ts` for the simplest possible reference adapter.

## Pull request checklist

- `npm run build` is clean (no TypeScript errors).
- `npm test` passes.
- New behaviour is covered by a unit test.
- No secrets, `.env` files, or generated `.lockstep/` runs are committed.
- User-facing changes are noted in [CHANGELOG.md](CHANGELOG.md) under
  *Unreleased*.

## Scope

Lockstep stays local-first and dependency-light. Hosted/cloud reporting and a
public results gallery are out of scope. If a change is large or alters a public
contract (the manifest schema, the run-file format, or a command's flags), please
open an issue to discuss it before opening the pull request.

## Commit style

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `test:`, `docs:`, `chore:`), with a short imperative summary and
a body explaining the *why*.

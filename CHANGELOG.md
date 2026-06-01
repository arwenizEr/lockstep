# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Keyless, deterministic `mock` provider for fully offline, zero-cost runs and
  for CI without secrets.
- Assertion types: `not_contains`, `icontains`, `equals`, `max_length`, and
  `min_length`.
- CI gate: `compare` and `report` accept `--fail-on <statuses>` and exit non-zero
  when any listed status is present.
- `compare --json` for machine-readable output.
- `run --junit <file>`: JUnit XML export for CI test dashboards.
- `report --format md`: GitHub-flavored Markdown report for pull-request comments.
- `lockstep list`: show saved runs, newest first.
- `run --dry-run`: preview the run matrix and pricing without calling providers.
- A keyless offline example suite (`examples/offline/`) and an example
  GitHub Actions PR-gate workflow (`examples/github-actions-gate.yml`).
- GitHub Actions CI (build and test on Node 20 and 22), `CONTRIBUTING.md`, this
  changelog, npm package metadata, and a `prepublishOnly` build hook.

### Fixed

- OpenAI adapter: enforce a request timeout (with `AbortController`) so a hung
  socket no longer stalls a run, and drop the sampling/effort parameters a model
  would reject (reasoning models versus chat models).
- Anthropic adapter: normalize and length-bound thrown errors for parity with the
  OpenAI adapter and to avoid bloating the run file.
- `compare`: exclude one-sided cases from the cost totals so the headline cost
  reflects only the compared cells.
- `.env` loader: strip unquoted trailing inline comments (e.g. `KEY=value # note`).

### Internal

- Offline test coverage for the runner and both provider adapters (injectable
  client/`fetch`), the config loader, and the gate.

## [0.1.0]

### Added

- `init`, `run`, `compare`, and `report` commands.
- Cross-provider runs behind a single `Provider` interface (Anthropic SDK and
  OpenAI via fetch), selected through a provider registry.
- Two-tier drift detection: Tier 1 deterministic (bag-of-words cosine similarity,
  assertions, JSON validity) and Tier 2 opt-in LLM-as-judge (`--judge`).
- Config-driven cost engine ($/M tokens) with an unpriced-model flag.
- Self-contained HTML report (inline CSS/JS, opens offline) with a headline
  verdict, status badges, a cost/latency table, and side-by-side highlighted diffs.
- Per-cell error isolation, a dependency-free concurrency limiter, and
  exponential-backoff retry on `429`/`5xx`.

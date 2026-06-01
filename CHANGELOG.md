# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-06-01

First public release.

### Commands

- `init`, `run`, `compare`, `report`, and `list`.

### Added

- Cross-provider runs behind a single `Provider` interface — Anthropic (SDK),
  OpenAI (via fetch), and a keyless, deterministic `mock` provider for fully
  offline, zero-cost runs and CI without secrets — selected through a registry.
- Two-tier drift detection: Tier 1 deterministic (bag-of-words cosine similarity,
  length delta, JSON validity, assertions) and Tier 2 opt-in LLM-as-judge
  (`--judge`).
- Assertion types: `json_valid`, `json_has_keys`, `contains`, `not_contains`,
  `icontains`, `equals`, `regex`, `max_length`, `min_length`, `json_path`.
- Config-driven cost engine ($/M tokens) with an unpriced-model flag.
- Self-contained HTML report (inline CSS/JS, opens offline) with a headline
  verdict, status badges, a cost/latency table, and side-by-side highlighted
  diffs; plus a Markdown report (`report --format md`) for pull-request comments.
- CI integration: `compare`/`report --fail-on <statuses>` exits non-zero on
  drift/regression; `run --junit <file>` writes a JUnit XML report; `compare
  --json` emits machine-readable output.
- `run --dry-run` previews the run matrix and pricing without calling providers.
- Per-cell error isolation, a dependency-free concurrency limiter, and
  exponential-backoff retry on `429`/`5xx`.
- An offline example suite (`examples/offline/`) and an example GitHub Actions
  PR-gate workflow (`examples/github-actions-gate.yml`).
- GitHub Actions CI (build and test on Node 20 and 22) and a `prepublishOnly`
  build hook.

### Reliability

- OpenAI adapter enforces a request timeout (`AbortController`) and drops the
  sampling/effort parameters a model would reject (reasoning vs chat models).
- Anthropic adapter normalizes and length-bounds thrown errors.
- `compare` excludes one-sided cases from the cost totals.
- The `.env` loader strips unquoted trailing inline comments.
- 163 offline tests, including a CLI smoke test that drives the built binary.

# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Case `defaults:`** — a `defaults:` block in `lockstep.yaml` supplies a shared
  `system` / `rubric` (used only where a case omits them) and `assert` entries
  (prepended to each case's own), so common settings live in one place.
- **Datasets** — a case can pull `{{input}}` values from `inputs_file`
  (`.jsonl`/`.json`/`.csv`/`.txt`) instead of an inline list.
- **Multi-turn cases** — a case can script a `messages` conversation instead of a
  single `prompt`; `{{input}}` is substituted in every turn.
- **Assertions** — `json_schema` (JSON-Schema subset: type/required/properties/
  items/enum) and `numeric` (`min`/`max`/`equals` with `tolerance`).
- **`run --cache`** — hash-keyed response cache (`.lockstep/cache/`); unchanged
  cases skip the provider call and its cost.
- **`run --max-cost <usd>`** — fail the run when total spend exceeds a budget.
- **`run --redact` / config `redact:`** — scrub secrets/PII (API keys, bearer
  tokens, emails, AWS keys, custom regex) from the saved run + report.
- **`run --watch`** — re-run on changes to the cases dir or `lockstep.yaml`.
- **`lockstep trend`** — similarity/cost/latency across many runs, with
  sparklines.
- **`lockstep baseline set|show|clear`** — pin a golden run that `compare`/
  `report` diff against by default.
- **`compare --semantic`** — embedding-based (OpenAI) similarity instead of
  bag-of-words.
- **`compare --judge-pairwise`** — LLM picks the better of A vs B per case.
- **Report UX** — sortable columns, a case/status filter, and a dark-mode toggle
  (still one self-contained, offline HTML file).
- **GitHub Action** — `.github/actions/lockstep` composite action and
  `examples/ci/github-actions.yml` to run prompt-CI on PRs and post the report.
- `lockstep ask [prompt]` — run one ad-hoc prompt (positional argument,
  `--file <path>`, or piped stdin) against every configured target and print a
  side-by-side comparison, with no cases file.
- `docs/USAGE.md` — full command reference with a runnable example and real
  output for every command.
- `lockstep ask --all` — compare a prompt across a built-in roster of every
  current model with no `lockstep.yaml` (live-verified: 15/15 respond).
- `examples/all-models.yaml` — every current Anthropic and OpenAI model as a
  target, with verified pricing and per-model accepted parameters set correctly
  (adaptive `effort` for the Opus 4.6+/Sonnet 4.6 line and OpenAI reasoning
  models; `temperature` for OpenAI chat models).

### Changed

- Anthropic adapter: the adaptive-thinking / `effort` path now covers the whole
  adaptive line (Opus 4.6, 4.7, 4.8 and Sonnet 4.6), not just Opus 4.8.

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

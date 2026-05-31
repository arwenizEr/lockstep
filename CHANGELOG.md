# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub Actions CI (build + test on Node 20 and 22).
- `CONTRIBUTING.md` and this changelog.
- Package metadata (`repository`, `homepage`, `bugs`, `keywords`) for npm.

### Changed

- `loadRunFile` and the case loader now report the offending file path on a
  malformed JSON / YAML parse instead of throwing a context-free error.
- Blank case files are skipped instead of producing a confusing validation error.

## [0.1.0]

### Added

- `init` / `run` / `compare` / `report` commands.
- Cross-provider runs behind one `Provider` interface (Anthropic SDK + OpenAI
  via fetch), selected through a provider registry.
- Two-tier drift detection: Tier-1 deterministic (bag-of-words cosine,
  assertions, JSON validity) and Tier-2 opt-in LLM-as-judge (`--judge`).
- Config-driven cost engine ($/M tokens) with an unpriced-model flag.
- Self-contained HTML report (inline CSS/JS, opens offline) with a headline
  verdict, status badges, cost/latency table, and side-by-side highlighted diff.
- Per-cell error isolation, dependency-free concurrency limiter, and
  exponential-backoff retry on 429/5xx.

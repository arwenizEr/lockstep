# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-06-11

### Added

- **Claude Fable 5 support** — `claude-fable-5` (and `claude-mythos-5`) in the
  Anthropic adapter, built-in roster, examples, and pricing ($10/$50 per MTok).
  Fable's always-on thinking is honored (no `thinking` param sent, sampling
  params always dropped, `effort: none/off` rejected with a clear error), and a
  `stop_reason: "refusal"` response (HTTP 200, empty content) now surfaces as an
  error with the policy category instead of a silently empty output.
- **`max` effort tier** accepted for the adaptive Anthropic line (Fable 5,
  Opus 4.6+, Sonnet 4.6).
- **Per-target `max_tokens`** in `lockstep.yaml` — overrides each adapter's
  built-in output ceiling (Anthropic `max_tokens`, OpenAI
  `max_completion_tokens`/`max_tokens`/`max_output_tokens` per API). Included in
  the response-cache key, so pre-existing cache entries are invalidated once.
- **Truncation flagging** — results now record `stopReason` and `truncated`
  (Anthropic `max_tokens`, OpenAI `length` / `max_output_tokens`), so a
  ceiling-clipped output is visible instead of passing as a normal result.
- **OpenAI Responses API** — set `mode: responses` on an openai target to route
  via `/responses` (enables Responses-only models like `gpt-5.5-pro`).
- **Prompt-cache cost accounting** — Anthropic `cache_read_input_tokens` /
  `cache_creation_input_tokens` are captured and billed at 0.1x / 1.25x the
  input price, so cached runs report true cost.
- **Dry-run cost estimate** — `run --dry-run` now shows a rough input-token and
  input-cost estimate per target (chars/4 heuristic; ~1.3x for Fable's heavier
  tokenizer), no API calls.

### Changed

- **Anthropic adapter streams by default** — uses `messages.stream()` +
  `finalMessage()` when available, so long thinking turns (minutes on Fable 5 at
  high effort) no longer risk non-streaming HTTP timeouts.

- **JUnit report** now emits a `<system-out>` per testcase with the (truncated)
  model output plus tokens/latency/cost and any judge score, so a CI test viewer
  shows what each prompt actually returned next to its pass/fail. BROKEN cells
  keep their `<error>` only.
- **Markdown report** now includes a `best` column (which target won each case —
  by judge score, then cost, then latency) and surfaces per-case judge scores +
  reasons inside the collapsible output blocks, so a PR comment is decision-ready.
- **Tier-1 similarity is now JSON-aware** — when both outputs parse as JSON they
  are compared structurally (key order + whitespace normalized), so equivalent
  JSON scores 1.0 instead of false-flagging `DRIFTED`. Falls back to bag-of-words
  cosine for non-JSON or non-equal JSON. Still offline and token-free.

### Added

- **Providers** — Google **Gemini** (`generateContent`), **OpenRouter** (one key,
  hundreds of models, OpenAI-compatible), and a keyless local **Ollama**
  (`/api/chat`) adapter, each behind the same `Provider` interface and unit-tested
  with an injected `fetch`. Registry now exposes anthropic, openai, gemini,
  openrouter, ollama, mock.
- **`lockstep doctor`** — checks which provider credentials are set and which
  configured targets are runnable before a run; `--strict` exits non-zero if any
  target is missing its key (a fast pre-CI sanity check).
- **`run --fail-on-assert`** — exit non-zero if any case is BROKEN or fails an
  assertion, so a single `run` gates CI without needing a second run to compare
  (complements `compare --fail-on`). Backed by a pure `runFailures()`.
- **Case `defaults:`** — a `defaults:` block in `lockstep.yaml` supplies a shared
  `system` / `rubric` (used only where a case omits them) and `assert` entries
  (prepended to each case's own), so common settings live in one place.
- **`lockstep trend --html`** — render the many-run trend as a self-contained
  HTML report (inline SVG charts, no CDN), the same shareable-artifact treatment
  the compare report already gets.
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

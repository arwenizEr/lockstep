<div align="center">

# Lockstep

**Prompt regression testing for the model-churn era.**

Replay your real prompts across models and providers, then see exactly what
changed in the output — and what it now costs — in one shareable report.

[![CI](https://github.com/arwenizEr/lockstep/actions/workflows/ci.yml/badge.svg)](https://github.com/arwenizEr/lockstep/actions/workflows/ci.yml)
&nbsp;[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
&nbsp;![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)

`lockstep run` · `lockstep compare` · `lockstep report`

[Why](#why) · [Quickstart](#quickstart) · [Commands](#commands) · [Architecture](ARCHITECTURE.md)

</div>

---

[![Lockstep report](docs/report-screenshot.png)](examples/sample-report.html)

<div align="center"><sub>The report is one self-contained HTML file. <a href="examples/sample-report.html">Open the live sample →</a></sub></div>

---

> Free and open source ([MIT](LICENSE)). No accounts, no cloud, no telemetry — it
> runs entirely on your machine.

## Why

Every model release quietly re-tunes three things at once: **behaviour, cost, and
accepted parameters.** You bump the model ID, and suddenly your extraction prompt
formats JSON a little differently, an effort tier means a different amount of
reasoning, the bill moves, and a sampling parameter you were sending starts
returning `400`.

The standard advice — "re-test your prompts after each release" — is a job for a
tool, not an afternoon of manual spot-checking. And because the value lies in
*neutrality* (comparing a vendor against its own past versions and against
competitors), no single vendor is going to build it for you.

Lockstep is that tool, kept deliberately small: define your prompts as test cases
once, run them against any set of models, and get a reviewable diff of output,
cost, and latency.

## How it works

1. **`run`** executes every *case × input × target* combination and records the
   output, token usage, cost, and latency to `.lockstep/runs/<timestamp>.json`.
2. **`compare`** pairs two runs case-by-case and classifies each result —
   `OK`, `DRIFTED`, `BROKEN`, `CHEAPER`, `PRICIER`, `FASTER`, or `SLOWER`.
3. **`report`** renders the comparison as a single self-contained HTML file —
   inline CSS/JS, no CDN, opens offline — with status badges, a cost-and-latency
   table, and side-by-side output panels with the text diff highlighted.

## Install

```bash
npm install -g lockstep      # once published — puts `lockstep` on your PATH
```

From a clone (current source):

```bash
git clone https://github.com/arwenizEr/lockstep && cd lockstep
npm install && npm run build && npm link
```

Either way you then call `lockstep …` directly. Prefer not to install? Prefix any
command with `npx` (`npx lockstep run`).

## Quickstart

```bash
# 1. Provide a key (or place it in a .env file — see .env.example)
export ANTHROPIC_API_KEY=sk-ant-...      # and/or OPENAI_API_KEY

# 2. Scaffold, run, and report
lockstep init && lockstep run && lockstep report
```

`init` writes `lockstep.yaml` and a `cases/` directory; `run` executes every case
against every target and saves the run; `report` renders `lockstep-report.html`.
Run it again after a model release and `report` diffs the two most recent runs.

### Try it with no API key

A built-in `mock` provider runs the entire pipeline offline and deterministically
at zero cost — useful for evaluating Lockstep or for running it in CI without
secrets. The [`examples/offline/`](examples/offline/) suite is configured this way:

```bash
cd examples/offline
lockstep run              # run twice to produce two comparable runs
lockstep run
lockstep compare
```

## Commands

> Full reference with example output for every command: **[docs/USAGE.md](docs/USAGE.md)**.

| Command | Description |
|---|---|
| `lockstep ask [prompt]` | Run one prompt (arg, `--file`, or stdin) against every target and compare side-by-side. Add `--all` to hit the built-in roster of all current models with **no config at all**. |
| `lockstep init` | Scaffold `lockstep.yaml` and `cases/example.yaml`. |
| `lockstep run` | Run every case × input × target; record output, tokens, cost, and latency to `.lockstep/runs/`. Flags: `--target <id>` (repeatable), `--concurrency <n>`, `--judge`, `--judge-model <model>`, `--junit <file>`, `--max-cost <usd>`, `--cache`, `--redact` / `--plaintext`, `--watch`, `--dry-run`. |
| `lockstep compare [A] [B]` | Diff two runs per case (similarity, cost/latency delta, status). Omit the paths to diff against a pinned baseline, else the two most recent runs. Flags: `--a-target`, `--b-target`, `--fail-on <statuses>`, `--json`, `--semantic`, `--judge-pairwise`. |
| `lockstep report [A] [B]` | Generate the report. Flags: `--format <html\|md>`, `-o <file>`, `--a-target`, `--b-target`, `--fail-on <statuses>`, `--semantic`. |
| `lockstep trend` | Show how a target's similarity, cost, and latency move across many saved runs (terminal sparklines, or a self-contained HTML report with `--html`). Flags: `--target <id>`, `--last <n>`, `--html`, `-o <file>`. |
| `lockstep baseline set\|show\|clear` | Pin a golden run that `compare`/`report` diff against by default. `set [run]` defaults to the newest run; `--target <id>` pins a target. |
| `lockstep doctor` | Check which provider credentials are set and which configured targets are runnable. `--strict` exits non-zero if any isn't. |
| `lockstep list` | List saved runs in `.lockstep/runs/` (newest first). |

Two targets within a single run can be compared by passing the same run file
twice with `--a-target` / `--b-target`.

### Run economics: cache, budget, watch

- **`--cache`** reuses saved responses for unchanged cases (same provider, model,
  messages, and params), so iterating on a report costs nothing for cells that
  didn't change. Cache lives in `.lockstep/cache/`.
- **`--max-cost <usd>`** fails the run (exit 1) if the total spend exceeds the
  budget — a guardrail for CI and for `ask --all`.
- **`--watch`** re-runs automatically when a case file or `lockstep.yaml` changes.
- **`--redact`** scrubs secrets/PII (API keys, bearer tokens, emails, AWS keys,
  plus any regex under `redact:` in config) from the *saved* run and report before
  they're shared. `--plaintext` forces it off.

### Gating CI

`compare` and `report` accept `--fail-on` and exit with a non-zero status when any
listed status is present, so a prompt regression fails the build:

```bash
lockstep run --junit results.xml            # JUnit XML for the CI test view
lockstep compare --fail-on drifted,broken   # exit 1 if anything drifted or broke
```

Accepted statuses: `drifted`, `broken`, `pricier`, `slower`, `cheaper`, `faster`.
`compare --json` emits the full comparison to stdout for scripting, `run --junit`
writes a JUnit report for CI dashboards, and `report --format md` renders a
Markdown summary suitable for a pull-request comment. Use `run --dry-run` to
preview the run matrix and pricing without spending tokens.

A ready-to-use GitHub Action and example workflow ship in
[`.github/actions/lockstep`](.github/actions/lockstep/action.yml) and
[`examples/ci/github-actions.yml`](examples/ci/github-actions.yml): commit a
baseline run, and every PR replays the suite, diffs it against the baseline,
gates on drift/breakage, and posts the Markdown report as a PR comment.

## Defining test cases

```yaml
- id: extract-invoice
  prompt: "Extract vendor, total, and currency as JSON from: {{input}}"
  system: "Output only JSON."
  inputs:
    - "Invoice from Acme Corp — 1240.00 USD, net 30."
  assert:                       # Tier 1: deterministic, offline, free
    - { type: json_valid }
    - { type: json_has_keys, keys: [vendor, total, currency] }
  rubric: "Did it extract all three fields without hallucinating?"   # Tier 2: opt-in judge
```

Assertion types: `json_valid`, `json_has_keys`, `json_schema` (validate against a
JSON-Schema subset), `numeric` (extract a number and check `min`/`max`/`equals`
with `tolerance`), `contains`, `not_contains`, `icontains`, `equals`, `regex`,
`max_length`, `min_length`, `json_path`.

Repeating `system` / `rubric` / `assert` across cases? Set them once under
`defaults:` in `lockstep.yaml` — `system` and `rubric` fill in only where a case
omits them, and default assertions are prepended to each case's own:

```yaml
# lockstep.yaml
defaults:
  system: "Output only JSON."
  assert:
    - { type: json_valid }
```

### Datasets and multi-turn

Inputs can come from a file instead of an inline list, and a case can script a
whole conversation instead of a single prompt:

```yaml
- id: classify
  prompt: "Classify the sentiment of: {{input}}"
  inputs_file: data/reviews.jsonl    # .jsonl / .json / .csv / .txt

- id: refund-bot
  system: "You are a terse support agent."
  messages:                          # multi-turn; {{input}} is substituted per turn
    - { role: user, content: "I want a refund." }
    - { role: assistant, content: "What's the order number?" }
    - { role: user, content: "{{input}}" }
  inputs: ["Order 5512, it arrived broken."]
```

`inputs_file` accepts `.jsonl`/`.ndjson` (one JSON string or `{input: …}` per
line), `.json` (an array), `.csv` (an `input` column or the first column), and
`.txt` (one input per line). Inline `inputs` are kept and the file's appended.

## Drift detection, in two tiers

- **Tier 1 — default, deterministic, offline, free.** Bag-of-words cosine
  similarity, length delta, JSON validity, and your assertions. Anything below the
  configured `similarity_threshold` is flagged `DRIFTED`. Tier 1 is **JSON-aware**:
  when both outputs parse as JSON it compares them structurally (key order and
  whitespace normalized), so equivalent JSON scores 1.0 instead of false-flagging
  drift — no tokens, no network.
- **Tier 1.5 — opt-in (`compare --semantic`), spends tokens.** Replaces
  bag-of-words cosine with OpenAI-embedding cosine, so a reordered-but-equivalent
  output (e.g. JSON keys in a different order) no longer reads as drift.
- **Tier 2 — opt-in (`--judge`), spends tokens.** A model scores each output
  against the case `rubric` (0–1 plus a one-line reason). Disabled by default so a
  plain run stays cheap. `compare --judge-pairwise` instead asks the judge to pick
  the better of A vs B per case — a stronger signal than two absolute scores.

## Cross-provider by design

Anthropic, OpenAI, Google Gemini, OpenRouter (one key, hundreds of models), a
keyless local **Ollama** adapter, and a keyless `mock` provider ship today, all
behind a single `Provider` interface. Adding another is one adapter file plus one line in
[`core/providers/registry.ts`](core/providers/registry.ts) — `config.ts` validates
the `provider` field against the registry, so the schema never needs editing.
`lockstep ask --all "…"` compares a prompt across every current model with no
config — it uses a built-in roster with prices and per-model accepted parameters
already set. [`examples/all-models.yaml`](examples/all-models.yaml) is the same
roster as a committable config.

Each adapter owns its provider's quirks: the OpenAI adapter drops the sampling
parameters a model rejects (reasoning models versus chat models) and applies a
request timeout; the Anthropic adapter maps an `effort` tier onto the
model-correct extended-thinking shape; Gemini uses role `model` for assistant
turns and `systemInstruction` for the system prompt; OpenRouter maps `effort`
onto a `reasoning` object; Ollama needs no key and talks to a local daemon. See
[ARCHITECTURE.md](ARCHITECTURE.md).

```yaml
targets:
  - { id: opus,     provider: anthropic,  model: claude-opus-4-8, effort: high }
  - { id: gpt,      provider: openai,     model: gpt-5.5,         effort: high }
  - { id: gemini,   provider: gemini,     model: gemini-2.5-pro }
  - { id: or-llama, provider: openrouter, model: meta-llama/llama-4-maverick }
  - { id: local,    provider: ollama,     model: llama3.2 }   # keyless, on your machine
```

Keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`),
`OPENROUTER_API_KEY`. Ollama needs none (`OLLAMA_HOST` overrides the daemon URL).

## Development

```bash
npm install
npm test           # 313 vitest tests (offline; includes a CLI smoke test, no API key required)
npm run dev -- run # run the CLI from source via tsx
npm run build      # type-check and compile to dist/
```

Prices in `lockstep.yaml` are config-driven and treated as untrusted defaults;
they change with every release, so verify them before relying on the cost figures.
Unknown models are flagged rather than silently costed at zero.

## License

[MIT](LICENSE).

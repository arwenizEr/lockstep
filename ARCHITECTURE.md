# Architecture

Lockstep is a small, local-first CLI. The guiding principle is that the
interesting parts — drift detection, cost calculation, gating, and the report —
are pure functions that can be unit-tested without a network, and the only code
that touches the outside world is a thin provider adapter behind a single-method
interface.

```
cli/index.ts                 commands: init · run · ask · compare · report · trend · baseline · doctor · list
core/
  config.ts                  load and zod-validate lockstep.yaml (incl. redact patterns)
  cases.ts                   load + validate cases (.yaml); prompt | messages; inputs_file; defaults merge
  dataset.ts                 parse inputs_file (.jsonl/.json/.csv/.txt)        (pure)
  env.ts                     zero-dependency .env loader (walks cwd upward)
  runner.ts                  orchestration: matrix run + buildTurns + plan/describe
  cache.ts                   hash-keyed response cache (memory + file)
  cost.ts                    config-driven price table and cost calculation   (pure)
  budget.ts                  the --max-cost decision over a run               (pure)
  diff.ts                    Tier-1 similarity (JSON-aware), assertions, compare (pure)
  embed.ts                   Tier-1.5 embedding similarity (opt-in; injectable)
  compare.ts                 pair two runs by case and aggregate               (pure)
  trend.ts                   many-run trend + sparklines                       (pure)
  trend-report.ts            self-contained HTML trend report (inline SVG)     (pure)
  baseline.ts                pin/read/clear a golden run pointer
  doctor.ts                  provider-credential + target-runnability check     (pure)
  gate.ts                    the --fail-on CI gate decision                    (pure)
  judge.ts                   Tier-2 LLM-as-judge: absolute score + pairwise (opt-in)
  redact.ts                  scrub secrets/PII from a saved run                (pure)
  watch.ts                   debounce + fs watchers for run --watch
  report.ts                  self-contained HTML report (sort/filter/dark)     (pure)
  report-md.ts               Markdown report for PR comments                   (pure)
  junit.ts                   JUnit XML export for CI                           (pure)
  models.ts                  built-in model roster for `ask --all`
  prompt.ts                  resolve an ad-hoc prompt (arg/file/stdin)         (pure)
  providers/
    types.ts                 the Provider interface
    registry.ts              provider id -> factory (single source of truth)
    anthropic.ts             Anthropic SDK adapter (injectable client)
    openai.ts                OpenAI Chat Completions adapter (fetch; timeout/abort)
    gemini.ts                Google Gemini generateContent adapter (fetch)
    openrouter.ts            OpenRouter gateway adapter — one key, many models (fetch)
    ollama.ts                local, keyless Ollama /api/chat adapter (fetch)
    mock.ts                  keyless deterministic adapter (offline / tests / CI)
```

## Data flow

```
lockstep.yaml + cases/*.yaml
        │  config.ts / cases.ts  (zod-validated)
        ▼
   runner.ts  ──►  providers/*  ──►  model APIs
        │              (Provider.run)
        ▼
  .lockstep/runs/<timestamp>.json     (one RunFile: every case × input × target result)
        │
        │  compare.ts  (pair two runs by caseId#inputIndex)
        ▼
   CompareReport  ──►  report.ts     ──►  one self-contained .html
                  ├─►  report-md.ts  ──►  Markdown (--format md)
                  ├─►  gate.ts       ──►  process exit code (--fail-on)
                  └─►  cli prints a terminal table (or JSON with --json)

   RunFile        ──►  junit.ts      ──►  JUnit XML (run --junit)
```

A **run** never mutates anything but its own output file. **compare** and
**report** are pure reads over saved run files, so a comparison can be re-diffed
and re-rendered offline, indefinitely, without spending tokens again.

## Key decisions

**The Provider interface is the seam.** Everything provider-specific lives behind
a single method:

```ts
interface Provider {
  id: string;
  run(req: { model; system?; messages; effort?; mode?; temperature?; topP?; topK? })
    : Promise<{ text; tokensIn; tokensOut; latencyMs; raw }>;
}
```

Adding a provider is two steps: write `core/providers/<name>.ts`, then add one
line to `registry.ts`. `config.ts` validates the `provider` field against the
registry, so the schema never needs editing. Adapters own their own quirks — the
OpenAI adapter drops the sampling parameters a model would reject (reasoning
models versus chat models) and enforces a request timeout; the Anthropic adapter
maps an `effort` tier onto the model-correct extended-thinking shape. Both real
adapters accept an injectable client/`fetch`, so request shaping and response
parsing are unit-tested without a network.

**Token counts come from the API, never estimated.** Cost is then a pure function
of `(tokensIn, tokensOut, price)`. The price table is config-driven and treated
as untrusted defaults — prices change with every release — and unknown models are
flagged `priced: false` rather than silently costed at zero.

**Drift detection is two tiers, cheap by default.** Tier 1 is deterministic and
offline: bag-of-words cosine similarity, length delta, JSON validity, and user
assertions. Tier 2 (LLM-as-judge) is opt-in behind `--judge` because it spends
tokens; a plain `run` never does.

**Errors are isolated per cell.** A `4xx`/`5xx` on one case is recorded as a
`BROKEN` result with its message while the rest of the matrix completes. The
runner caps concurrency (default 4) and retries `429`/`5xx` with exponential
backoff, but never retries other `4xx` responses.

**The report is one self-contained file.** All CSS and JS are inlined — no CDN,
no fonts, no network — so it opens offline and survives being emailed or hosted on
any static bucket. `report.ts` is a pure `CompareReport -> string`, which makes it
straightforward to snapshot-test for self-containment and HTML escaping.

**Gating is a pure decision.** `gate.ts` maps a `--fail-on` status list onto the
comparison summary and returns whether the build should fail; the CLI translates
that into an exit code. This keeps the CI contract testable in isolation.

## Testing

The pure and near-pure modules — `cost`, `diff`, `compare`, `gate`, `report`,
`report-md`, `junit`, `judge`, `env`, `registry`, `config`, `cases` — are
unit-tested with vitest and require no API key. The runner and both real provider adapters are also covered
offline: the adapters take an injectable client/`fetch`, and the keyless `mock`
provider drives the runner end-to-end without a network. The suite is fully
offline by design; anything requiring a live API call belongs in a manual check
rather than the test run.

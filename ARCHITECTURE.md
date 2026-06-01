# Architecture

Lockstep is a small, local-first CLI. The design goal is that the interesting
parts — drift detection, cost, the report — are pure functions you can unit-test
without a network, and the only thing that touches the outside world is a thin
provider adapter behind a one-method interface.

```
cli/index.ts                 commands: init · run · compare · report · list
core/
  config.ts                  load + zod-validate lockstep.yaml
  cases.ts                   load + validate case files (.yaml; assertion schema)
  env.ts                     zero-dep .env loader (walks cwd upward)
  runner.ts                  orchestration: case × input × target matrix; planRun/describeRun
  cost.ts                    config-driven price table + cost calc       (pure)
  diff.ts                    Tier-1 similarity + assertions + per-cell compare (pure)
  compare.ts                 pair two runs by case, aggregate             (pure)
  gate.ts                    --fail-on CI gate decision                   (pure)
  judge.ts                   Tier-2 LLM-as-judge (opt-in)
  report.ts                  self-contained HTML report                  (pure)
  report-md.ts               Markdown report for PR comments             (pure)
  junit.ts                   JUnit XML export for CI                      (pure)
  providers/
    types.ts                 the Provider interface
    registry.ts              provider id -> factory (single source of truth)
    anthropic.ts             adapter (injectable client)
    openai.ts                adapter (fetch, injectable; timeout/abort)
    mock.ts                  keyless deterministic adapter (offline/tests/CI)
```

## Data flow

```
lockstep.yaml + cases/*.yaml
        │  config.ts / cases.ts  (zod-validated)
        ▼
   runner.ts  ──►  providers/*  ──►  model APIs
        │              (Provider.run)
        ▼
  .lockstep/runs/<ISO>.json     (one RunFile: every case×input×target result)
        │
        │  compare.ts  (pair two runs by caseId#inputIndex)
        ▼
   CompareReport  ──►  report.ts  ──►  one self-contained .html
                  └─►  cli prints a terminal table
```

A **run** never mutates anything but its own output file. **compare** and
**report** are pure reads over saved run files, so you can re-diff and re-render
offline, forever, without spending tokens again.

## Key decisions

**The Provider interface is the seam.** Everything provider-specific lives behind
one method:

```ts
interface Provider {
  id: string;
  run(req: { model; system?; messages; effort?; mode?; temperature?; topP?; topK? })
    : Promise<{ text; tokensIn; tokensOut; latencyMs; raw }>;
}
```

Adding a provider is two steps: write `core/providers/<name>.ts`, then add one
line to `registry.ts`. `config.ts` validates the `provider:` field against the
registry, so the schema never needs editing. Adapters own their quirks — e.g. the
Anthropic adapter drops `temperature/top_p/top_k` for models that 400 on them,
and maps an `effort` tier onto the model-correct extended-thinking shape
(`thinking.adaptive` + `output_config.effort` for opus-4-8, `budget_tokens` for
older 4.x models).

**Token counts come from the API, never estimated.** Cost is then a pure function
of `(tokensIn, tokensOut, price)`. The price table is config-driven and treated
as untrusted defaults (prices drift every release); unknown models are flagged
`priced: false` rather than silently costed at zero.

**Drift detection is two tiers, cheap by default.** Tier 1 is deterministic and
offline: bag-of-words cosine similarity + length delta + JSON validity + user
assertions. Tier 2 (LLM-as-judge) is opt-in behind `--judge` because it costs
tokens. A plain `run` never spends judge tokens.

**Errors are isolated per cell.** A 400/500 on one case is recorded as a `BROKEN`
result with its message; the rest of the matrix still completes. The runner caps
concurrency (default 4) and retries 429/5xx with exponential backoff, but never
retries other 4xx (they won't get better).

**The report is one self-contained file.** All CSS/JS is inlined — no CDN, no
fonts, no network — so it opens offline and survives being emailed or hosted on
any static bucket. `report.ts` is a pure `CompareReport -> string`, which is why
it's straightforward to snapshot-test for self-containment and HTML escaping.

## Testing

The pure modules (`cost`, `diff`, `compare`, `gate`, `report`, `report-md`,
`junit`, `judge` parser, `env`, `registry`, `config`, `cases`) are unit-tested
with vitest and need no API key. The runner and both real provider adapters are
covered offline too — the adapters take an injectable client/`fetch`, and the
keyless `mock` provider drives the runner end-to-end without a network. The
`examples/offline/` suite runs the whole pipeline with zero cost; `examples/`
(live Anthropic + OpenAI) is the real cross-provider demo.

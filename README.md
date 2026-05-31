<div align="center">

# ◧ Lockstep

**Prompt-CI for the model-churn era.** Replay your real prompts across models &
providers, then see exactly *what changed in the output* and *what it costs now* —
in one shareable HTML report.

`npx lockstep run` · `npx lockstep report`

[Live sample report](#) · [Why](#why-i-built-this) · [Quickstart](#quickstart) · [How it works](ARCHITECTURE.md)

</div>

---

> Free and open source ([MIT](LICENSE)). No accounts, no cloud, no upsell — it runs
> entirely on your machine.

## Why I built this

Every model release silently re-tunes three things at once: **behavior, cost, and
parameters.** A new Opus drops, you swap the model ID, and now your extraction
prompt formats JSON slightly differently, your effort tier means a different
amount of thinking, your bill changed, and a sampling parameter you were sending
suddenly returns a 400.

The official advice is "re-test your own prompts after each release." That's a job
for a tool, not an afternoon of manual spot-checking. And because the value is
*neutrality* — comparing a vendor to itself across versions, and to its
competitors — no single vendor will build it for you.

Lockstep is that tool, kept deliberately small: define your prompts as test cases
once, run them against any set of models, and get a diff of output + cost +
latency that you can screenshot and share.

## The report (the whole point)

The output is **one self-contained HTML file** — inline CSS/JS, no CDN, opens
offline, looks good as a screenshot. A real cross-provider run produces a headline
like:

> **claude-opus-4-8 vs gpt-4o-mini: 1 drifted, ~65× pricier, 1.6× faster.**

(that line is the real headline from [`examples/sample-report.html`](examples/sample-report.html))

…with per-case status badges (`OK` / `DRIFTED` / `BROKEN` / `CHEAPER` / `PRICIER`
/ `FASTER` / `SLOWER`), a cost-and-latency table per task, and side-by-side
before/after panels with the text diff highlighted.

<!-- SCREENSHOT: replace this with an image of examples/sample-report.html -->
<!-- ![Lockstep report](docs/report-screenshot.png) -->

> 📸 **Screenshot placeholder.** Open
> [`examples/sample-report.html`](examples/sample-report.html) in a browser,
> screenshot it to `docs/report-screenshot.png`, then uncomment the line above.

<!-- DEMO GIF: a ~15s terminal capture of `lockstep run` then opening the report. -->
<!-- ![demo](docs/demo.gif) -->

> 🎬 **Demo GIF placeholder.** Record a ~15s clip — run `lockstep run`, then open
> the report — and drop it at `docs/demo.gif`. Easiest tools: **ScreenToGif**
> (Windows), **Kap** (macOS), or
> `terminalizer record demo && terminalizer render demo`.

## Quickstart

```bash
# 1. set a key (or put it in a .env file — see .env.example)
export ANTHROPIC_API_KEY=sk-ant-...      # and/or OPENAI_API_KEY

# 2. scaffold, run, report
npx lockstep init && npx lockstep run && npx lockstep report
```

That writes `lockstep.yaml` + `cases/`, runs every case against every target,
saves the run to `.lockstep/runs/`, and emits `lockstep-report.html`. Run it again
after a model release and `lockstep report` diffs the two newest runs.

## Try the committed demo

The [`examples/`](examples/) folder is a real, runnable suite plus a generated
report, so you can see the output without spending a token:

- [`examples/lockstep.yaml`](examples/lockstep.yaml) — two targets, OpenAI + Anthropic
- [`examples/cases/suite.yaml`](examples/cases/suite.yaml) — extraction, classification, summary
- [`examples/sample-run.json`](examples/sample-run.json) — the raw recorded run (real API output)
- [`examples/sample-report.html`](examples/sample-report.html) — the rendered cross-provider report

Open `sample-report.html` directly in a browser, or regenerate everything:

```bash
cd examples
npx lockstep run --judge
npx lockstep report sample-run.json sample-run.json \
  --a-target gpt-4o-mini --b-target opus-4-8 -o sample-report.html
```

> **Host it:** because the report is a single static file, you can drop
> `examples/sample-report.html` on GitHub Pages or Cloudflare Pages and link it
> from the "Live sample report" badge at the top.

## Commands

| Command | What it does |
|---|---|
| `lockstep init` | Scaffold `lockstep.yaml` + `cases/example.yaml`. |
| `lockstep run` | Run every case × input × target; record output + tokens + cost + latency to `.lockstep/runs/<ISO>.json`. Flags: `--target <id>` (repeatable), `--concurrency <n>`, `--judge`, `--judge-model`. |
| `lockstep compare [A] [B]` | Per-case similarity, cost/latency delta, status. Omit paths to diff the two newest runs. |
| `lockstep report [A] [B]` | Generate the self-contained HTML report. `-o <file>`, `--a-target`, `--b-target`. |

You can also compare two targets **within one run** by passing the same run file
twice with `--a-target` / `--b-target` (that's how the cross-provider demo above
is made).

## Test cases

```yaml
- id: extract-invoice
  prompt: "Extract vendor, total, and currency as JSON from: {{input}}"
  system: "Output only JSON."
  inputs:
    - "Invoice from Acme Corp — 1240.00 USD, net 30."
  assert:                       # Tier-1: deterministic, free, offline
    - { type: json_valid }
    - { type: json_has_keys, keys: [vendor, total, currency] }
  rubric: "Did it extract all three fields without hallucinating?"   # Tier-2: judge, opt-in
```

Assertion types: `json_valid`, `json_has_keys`, `contains`, `regex`, `json_path`.

## Drift detection, two tiers

- **Tier 1 — default, deterministic, offline, free.** Bag-of-words cosine
  similarity + length delta + JSON validity + your assertions. Anything below the
  `similarity_threshold` is flagged `DRIFTED`.
- **Tier 2 — opt-in (`--judge`), costs tokens.** An LLM scores each output against
  the case `rubric` (0–1 + a one-line reason). Off by default so a plain run is
  cheap.

## Cross-provider by design

Anthropic and OpenAI ship today, behind one `Provider` interface; adding a third
is one adapter file + one line in
[`core/providers/registry.ts`](core/providers/registry.ts). Adapters own provider
quirks — e.g. the Anthropic adapter drops `temperature/top_p/top_k` for models
that reject them and maps an `effort` tier onto the model-correct extended-thinking
shape. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Development

```bash
npm install
npm test           # 87 vitest unit tests (cost, diff, compare, cases, report, judge, env, registry)
npm run dev -- run # run the CLI from source via tsx
npm run build      # compile to dist/
```

Prices in `lockstep.yaml` are config-driven and treated as untrusted defaults —
they drift every release, so verify them before relying on the cost numbers.

## License

[MIT](LICENSE) — use it, fork it, no strings.

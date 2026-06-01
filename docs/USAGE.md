# Usage

Every command with a runnable example and its real output. The outputs below were
captured against the keyless `mock` provider, so you can reproduce them with no
API key (see [`examples/offline/`](../examples/offline/)). The mock provider
echoes the prompt deterministically — with real providers the outputs differ, and
JSON-assertion cases pass instead of showing `BROKEN`.

---

## `lockstep ask` — one prompt, every model, no cases file

Type a prompt and run it against every configured target at once. The prompt can
be a positional argument, `--file <path>` (for long prompts), or piped on stdin.

```bash
lockstep ask "Reply with the single word: ready"
# long prompt from a file:
lockstep ask --file ./prompt.txt
# or piped:
cat prompt.txt | lockstep ask
```

By default it prints the comparison table only (the full run, including every
model's output, is saved to `.lockstep/runs/`). Pass `--output` to also print
each model's full answer; failed targets always show their error.

```text
Asking 2 target(s)...

  target       model            tok in/out  cost      latency  status
  -----------  ---------------  ----------  --------  -------  ------
  gpt-4o-mini  gpt-4o-mini      6/6         $0.00000  90ms     OK
  opus         claude-opus-4-8  6/6         $0.00018  90ms     OK

cheapest: gpt-4o-mini ($0.0000) · fastest: gpt-4o-mini (90ms)

outputs saved — pass --output to print them, or use `lockstep report`.
```

Flags: `--all`, `--output`, `--system <text>`, `-t, --target <id>` (repeatable),
`-c, --concurrency <n>`.

To run against the whole field with **no config at all**, add `--all` — it uses a
built-in roster of every current Anthropic and OpenAI model, with prices and the
accepted parameters already set per model:

```bash
lockstep ask --all "Explain a monad in one sentence."   # fans out to all 15 models
```

(Or commit the roster as your own config: `cp examples/all-models.yaml lockstep.yaml`.)

---

## `lockstep init` — scaffold a project

```bash
lockstep init
```

```text
Created:
  lockstep.yaml
  cases/example.yaml

Next:
  export ANTHROPIC_API_KEY=sk-...
  lockstep run
```

---

## `lockstep run` — run every case across every target

Runs `case × input × target` and records each result to `.lockstep/runs/<timestamp>.json`.

```bash
lockstep run
```

```text
Running 6 job(s) (concurrency 4)...

  [1/6] ok  gpt-4o-mini :: extract-invoice#0  54ms  $0.00001
  [2/6] ok  opus :: extract-invoice#0  54ms  $0.00055
  [3/6] ok  gpt-4o-mini :: extract-invoice#1  21ms  $0.00001
  [4/6] ok  opus :: extract-invoice#1  21ms  $0.00055
  [5/6] ok  gpt-4o-mini :: summarize-one-line#0  36ms  $0.00001
  [6/6] ok  opus :: summarize-one-line#0  36ms  $0.00057

Saved run -> .lockstep/runs/2026-06-01T07-23-28-823Z.json

  target       cases  broken  cost     tokens  avg ms
  -----------  -----  ------  -------  ------  ------
  gpt-4o-mini  3      0       $0.0000  124     37
  opus         3      0       $0.0017  124     37
```

Flags: `-t, --target <id>` (repeatable), `-c, --concurrency <n>`, `--judge`,
`--judge-model <model>`, `--junit <file>`, `--dry-run`.

### `run --dry-run` — preview without calling providers

```bash
lockstep run --dry-run
```

```text
Dry run — 6 cell(s), no providers called:

  target       model            cells  priced
  -----------  ---------------  -----  ------
  gpt-4o-mini  gpt-4o-mini      3      yes
  opus         claude-opus-4-8  3      yes
```

### `run --junit <file>` — JUnit XML for CI

```bash
lockstep run --junit results.xml
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="lockstep" tests="6" failures="4" errors="0" time="0.222">
  <testsuite name="lockstep" tests="6" failures="4" errors="0" timestamp="..." time="0.222">
    <testcase name="extract-invoice#0" classname="gpt-4o-mini" time="0.054">
      <failure message="json_valid: output is not valid JSON" type="AssertionError"/>
    </testcase>
    ...
```

---

## `lockstep compare [A] [B]` — diff two runs

Pairs two runs case-by-case. Omit the paths to diff the two most recent runs;
pass the same run file twice with `--a-target`/`--b-target` to compare two models
within one run.

```bash
lockstep compare                                   # two newest runs
lockstep compare runA.json runB.json --a-target gpt-4o-mini --b-target opus
```

```text
  A: gpt-4o-mini (gpt-4o-mini)   B: opus (claude-opus-4-8)
  drift threshold: 90% similarity

  case                  sim   Δ cost     Δ lat  status
  --------------------  ----  ---------  -----  --------------
  extract-invoice#0     100%  +$0.00054  0ms    BROKEN,PRICIER
  extract-invoice#1     100%  +$0.00054  0ms    BROKEN,PRICIER
  summarize-one-line#0  100%  +$0.00056  0ms    PRICIER

  0 ok · 0 drifted · 2 broken · 0 cheaper · 3 pricier · 0 faster · 0 slower
  total cost: $0.0000 (A) -> $0.0017 (B)
```

Flags: `--a-target`, `--b-target`, `--fail-on <statuses>`, `--json`.

### `compare --fail-on` — gate CI

Exits non-zero when any listed status is present (`drifted`, `broken`, `pricier`,
`slower`, `cheaper`, `faster`):

```bash
lockstep compare --fail-on drifted,broken ; echo "exit: $?"
# exit: 1   (when something drifted or broke)
```

`compare --json` prints the full comparison object to stdout for scripting.

---

## `lockstep report [A] [B]` — shareable report

```bash
lockstep report                       # self-contained HTML (default)
lockstep report --format md -o out.md # Markdown for a PR comment
```

```text
Wrote html report -> lockstep-report.html
  gpt-4o-mini vs opus · 3 cases · 0 drifted · 2 broken
```

The HTML report is a single self-contained file (see
[`examples/sample-report.html`](../examples/sample-report.html) and the
screenshot in the [README](../README.md)). Flags: `-o <file>`,
`--format <html|md>`, `--a-target`, `--b-target`, `--fail-on <statuses>`.

---

## `lockstep list` — saved runs

```bash
lockstep list
```

```text
  run                            targets           results  broken  cost
  -----------------------------  ----------------  -------  ------  -------
  2026-06-01T07-23-43-066Z.json  gpt-4o-mini,opus  6        0       $0.0017
  2026-06-01T07-23-28-823Z.json  gpt-4o-mini,opus  6        0       $0.0017
  2026-06-01T07-23-14-918Z.json  gpt-4o-mini,opus  2        0       $0.0002
```

import type { Trend } from "./trend.js";

// ---------------------------------------------------------------------------
// Self-contained HTML trend report. Like report.ts: all CSS inline, no CDN, no
// fonts, no network — opens offline and screenshots cleanly. Charts are inline
// SVG polylines (no chart library). Turns `lockstep trend` from a terminal
// glance into a shareable artifact.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 0.01 ? 5 : abs < 1 ? 4 : 2;
  return (n < 0 ? "-$" : "$") + abs.toFixed(digits);
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms";
}

const W = 320;
const H = 64;
const PAD = 6;

/**
 * Inline SVG line chart over a numeric series. `null` values break the line into
 * segments (a gap, not a drop to zero). min/max default to the data extent; pass
 * fixed bounds (e.g. 0..1 for similarity) for a comparable vertical scale.
 */
export function svgLine(
  values: (number | null)[],
  opts: { min?: number; max?: number; stroke?: string; fixedZeroOne?: boolean } = {}
): string {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const stroke = opts.stroke ?? "currentColor";
  if (finite.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none"></svg>`;
  }
  const lo = opts.fixedZeroOne ? 0 : (opts.min ?? Math.min(...finite));
  const hi = opts.fixedZeroOne ? 1 : (opts.max ?? Math.max(...finite));
  const span = hi - lo || 1;
  const n = values.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);

  // Split into contiguous segments around null gaps.
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
    } else {
      cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (cur.length) segments.push(cur.join(" "));

  const polylines = segments
    .map(
      (pts) =>
        `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join("");
  // Dots for the last point of each segment so single-point series are visible.
  const lastVals = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null && Number.isFinite(p.v));
  const last = lastVals[lastVals.length - 1];
  const dot = last
    ? `<circle cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="2.5" fill="${stroke}"/>`
    : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none">${polylines}${dot}</svg>`;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(0)}%`;
}

export function renderTrendReport(trend: Trend, generatedAt = ""): string {
  const n = trend.points.length;
  const costs = trend.points.map((p) => p.totalCost);
  const lats = trend.points.map((p) => p.avgLatencyMs);
  const firstAt = trend.startedAts[0] ?? "";
  const lastAt = trend.startedAts[n - 1] ?? "";

  const caseRows = trend.cases
    .map((c) => {
      const first = c.similarities[0];
      const last = c.similarities[c.similarities.length - 1];
      const dropped = first !== null && last !== null && last < first - 0.001;
      const lastCls = dropped ? ' class="drop"' : "";
      return `<tr>
        <td class="case">${esc(c.key)}</td>
        <td class="chart sim"><span class="chwrap">${svgLine(c.similarities, { fixedZeroOne: true })}</span></td>
        <td class="r">${pct(first)} <span class="arrow">→</span> <strong${lastCls}>${pct(last)}</strong></td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lockstep trend — ${esc(trend.target)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand">◧ lockstep <span class="brand-sub">trend</span></div>
  <h1>${esc(trend.target)}</h1>
  <p class="sub">${n} runs · <span class="muted">${esc(firstAt)} → ${esc(lastAt)}</span></p>
</header>

<main>
  <section class="cards">
    <div class="card">
      <div class="lbl">total cost · per run</div>
      <div class="chart cost">${svgLine(costs, { stroke: "var(--b)" })}</div>
      <div class="ends">${fmtUsd(costs[0] ?? 0)} <span class="arrow">→</span> ${fmtUsd(costs[n - 1] ?? 0)}</div>
    </div>
    <div class="card">
      <div class="lbl">avg latency · per run</div>
      <div class="chart lat">${svgLine(lats, { stroke: "var(--drift)" })}</div>
      <div class="ends">${fmtMs(lats[0] ?? 0)} <span class="arrow">→</span> ${fmtMs(lats[n - 1] ?? 0)}</div>
    </div>
  </section>

  <section>
    <h2>Similarity to first run · per case</h2>
    <div class="table-wrap">
    <table>
      <thead><tr><th>case</th><th>trend (0–100%)</th><th class="r">first → last</th></tr></thead>
      <tbody>${caseRows}</tbody>
    </table>
    </div>
  </section>
</main>

<footer>Generated with <strong>lockstep</strong> · open-source prompt-CI · ${esc(generatedAt)}</footer>
</div>
</body>
</html>`;
}

const CSS = `
:root{
  --bg:#f6f7f9;--surface:#fff;--ink:#1a1f29;--ink-soft:#5b6573;--line:#e4e7ec;
  --subtle:#fafbfc;--a:#2563eb;--b:#7c3aed;--drift:#c47d00;--ok:#0f9d58;--broken:#d92d20;
  --shadow:0 1px 2px rgba(16,24,40,.04),0 4px 16px rgba(16,24,40,.06);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0d1117;--surface:#161b22;--ink:#e6edf3;--ink-soft:#8b949e;--line:#30363d;
  --subtle:#1b222b;--a:#4493f8;--b:#a371f7;--drift:#d29922;--ok:#3fb950;--broken:#f85149;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 4px 16px rgba(0,0,0,.5);
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
.wrap{max-width:960px;margin:0 auto;padding:0 24px 64px;}
header{padding:44px 0 24px;}
.brand{font-weight:700;color:var(--ink);} .brand-sub{color:var(--ink-soft);font-weight:500;margin-left:2px;}
h1{margin:16px 0 6px;font-size:clamp(26px,5vw,38px);font-weight:800;letter-spacing:-.025em;}
.sub{margin:0;color:var(--ink);} .muted{color:var(--ink-soft);}
h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-soft);margin:0 0 12px;}
main{display:flex;flex-direction:column;gap:36px;}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:var(--shadow);}
.card .lbl{color:var(--ink-soft);font-size:12px;text-transform:uppercase;letter-spacing:.05em;}
.card .ends{font-weight:700;font-variant-numeric:tabular-nums;margin-top:6px;}
.arrow{color:var(--ink-soft);font-weight:500;}
.chart{display:block;}
.spark{width:100%;height:64px;display:block;color:var(--a);}
.cost .spark{height:72px;} .lat .spark{height:72px;}
.table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);}
table{width:100%;border-collapse:collapse;font-size:14px;}
th,td{text-align:left;padding:10px 16px;border-bottom:1px solid var(--line);vertical-align:middle;}
tr:last-child td{border-bottom:none;}
thead th{color:var(--ink-soft);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;background:var(--subtle);}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
td.case{font-weight:600;white-space:nowrap;}
td.chart{width:55%;color:var(--a);}
.chwrap{display:block;width:100%;}
strong.drop{color:var(--broken);}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);color:var(--ink-soft);font-size:13px;}
@media (max-width:640px){.cards{grid-template-columns:1fr;}}
`;

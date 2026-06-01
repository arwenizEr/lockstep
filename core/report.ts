import type { CompareReport, PairedResult } from "./compare.js";
import type { CaseResult } from "./runner.js";

// ---------------------------------------------------------------------------
// Self-contained HTML report. No CDN, no network — everything inline so the
// file opens offline and is screenshot-able. This file IS the product.
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

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(0)}%`;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms";
}

function statusBadge(s: string): string {
  return `<span class="badge badge-${s.toLowerCase()}">${s}</span>`;
}

/** Word-level diff: tokens in B-not-A are "add", tokens in A-not-B are "rm". */
function wordDiff(a: string, b: string): { a: string; b: string } {
  const aTok = a.split(/(\s+)/);
  const bTok = b.split(/(\s+)/);
  const aSet = new Set(aTok.map((t) => t.trim()).filter(Boolean));
  const bSet = new Set(bTok.map((t) => t.trim()).filter(Boolean));
  const render = (tokens: string[], otherSet: Set<string>, cls: string) =>
    tokens
      .map((t) => {
        const trimmed = t.trim();
        if (!trimmed) return esc(t);
        return otherSet.has(trimmed) ? esc(t) : `<span class="${cls}">${esc(t)}</span>`;
      })
      .join("");
  return {
    a: render(aTok, bSet, "rm"),
    b: render(bTok, aSet, "add"),
  };
}

// ---------------------------------------------------------------------------
// Verdict computation
// ---------------------------------------------------------------------------

/** One-line human verdict: "claude-opus-4-8: 2 drifted, 1 broke, ~18% cheaper, 1.3x faster". */
export function headlineVerdict(report: CompareReport): string {
  const s = report.summary;
  const parts: string[] = [];

  if (s.drifted > 0) parts.push(`${s.drifted} drifted`);
  if (s.broken > 0) parts.push(`${s.broken} broke`);
  if (s.drifted === 0 && s.broken === 0) parts.push("no drift, nothing broke");

  // Overall cost direction. Use a multiplier for big gaps (cleaner than "3000%").
  if (s.totalCostA > 0 && s.totalCostB > 0) {
    const pct = (s.totalCostB - s.totalCostA) / s.totalCostA;
    const word = pct < 0 ? "cheaper" : "pricier";
    if (Math.abs(pct) < 0.01) {
      parts.push("same cost");
    } else if (pct >= 3) {
      parts.push(`~${(s.totalCostB / s.totalCostA).toFixed(0)}× pricier`);
    } else if (pct <= -0.75) {
      parts.push(`~${(s.totalCostA / s.totalCostB).toFixed(0)}× cheaper`);
    } else {
      parts.push(`~${Math.abs(pct * 100).toFixed(0)}% ${word}`);
    }
  }

  // Average latency direction (over non-broken pairs).
  const lat = report.pairs
    .map((p) => p.cell)
    .filter((c): c is NonNullable<typeof c> => !!c && !c.broken);
  if (lat.length > 0) {
    let aSum = 0;
    let bSum = 0;
    for (const p of report.pairs) {
      if (p.a && p.b && p.cell && !p.cell.broken) {
        aSum += p.a.latencyMs;
        bSum += p.b.latencyMs;
      }
    }
    if (aSum > 0 && bSum > 0) {
      const ratio = bSum / aSum;
      if (ratio <= 0.9) parts.push(`${(1 / ratio).toFixed(1)}× faster`);
      else if (ratio >= 1.1) parts.push(`${ratio.toFixed(1)}× slower`);
    }
  }

  return `${report.bModel} vs ${report.aModel}: ${parts.join(", ")}.`;
}

function verdictFor(pair: PairedResult): string {
  if (!pair.cell || !pair.a || !pair.b) {
    if (pair.a && !pair.b) return "A (B missing)";
    if (pair.b && !pair.a) return "B (A missing)";
    return "—";
  }
  const { cell } = pair;
  if (cell.broken) {
    const aOk = pair.a.status === "OK" && pair.a.assertionsPass !== false;
    const bOk = pair.b.status === "OK" && pair.b.assertionsPass !== false;
    if (aOk && !bOk) return "A (B broke)";
    if (bOk && !aOk) return "B (A broke)";
    return "neither";
  }
  const aj = pair.a.judge?.score;
  const bj = pair.b.judge?.score;
  if (aj !== undefined && bj !== undefined && Math.abs(aj - bj) > 0.05) {
    return aj > bj ? "A (better)" : "B (better)";
  }
  if (cell.costDelta < 0) return "B (cheaper)";
  if (cell.costDelta > 0) return "A (cheaper)";
  if (cell.latencyDelta < 0) return "B (faster)";
  if (cell.latencyDelta > 0) return "A (faster)";
  return "tie";
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderReport(report: CompareReport): string {
  const { aTargetId, bTargetId, aModel, bModel, summary } = report;
  const verdict = headlineVerdict(report);

  const summaryCards = `
    <div class="cards">
      <div class="card"><div class="num">${summary.total}</div><div class="lbl">cases</div></div>
      <div class="card ok"><div class="num">${summary.ok}</div><div class="lbl">unchanged</div></div>
      <div class="card drift"><div class="num">${summary.drifted}</div><div class="lbl">drifted</div></div>
      <div class="card broken"><div class="num">${summary.broken}</div><div class="lbl">broken</div></div>
      <div class="card"><div class="num">${fmtUsd(summary.totalCostA)} <span class="arrow">→</span> ${fmtUsd(summary.totalCostB)}</div><div class="lbl">total cost · A → B</div></div>
    </div>`;

  const verdictRows = report.pairs
    .map((p) => {
      const sim = p.cell ? (p.cell.similarity * 100).toFixed(0) + "%" : "—";
      const badges = p.cell
        ? p.cell.statuses.map(statusBadge).join(" ")
        : statusBadge("BROKEN");
      return `<tr>
        <td class="case">${esc(p.caseId)}<span class="muted">#${p.inputIndex}</span></td>
        <td>${badges}</td>
        <td class="r">${sim}</td>
        <td class="best"><strong>${esc(verdictFor(p))}</strong></td>
      </tr>`;
    })
    .join("\n");

  const costRows = report.pairs
    .map((p) => {
      const a = p.a;
      const b = p.b;
      const deltaCls = p.cell
        ? p.cell.costDelta < 0
          ? "pos"
          : p.cell.costDelta > 0
            ? "neg"
            : ""
        : "";
      const latCls = p.cell
        ? p.cell.latencyDelta < 0
          ? "pos"
          : p.cell.latencyDelta > 0
            ? "neg"
            : ""
        : "";
      return `<tr>
        <td class="case">${esc(p.caseId)}<span class="muted">#${p.inputIndex}</span></td>
        <td class="r">${a ? fmtUsd(a.cost) : "—"}</td>
        <td class="r">${b ? fmtUsd(b.cost) : "—"}</td>
        <td class="r ${deltaCls}">${p.cell ? fmtUsd(p.cell.costDelta) : "—"}</td>
        <td class="r ${deltaCls}">${p.cell ? fmtPct(p.cell.costPct) : "—"}</td>
        <td class="r">${a ? fmtMs(a.latencyMs) : "—"}</td>
        <td class="r">${b ? fmtMs(b.latencyMs) : "—"}</td>
        <td class="r ${latCls}">${p.cell ? (p.cell.latencyDelta >= 0 ? "+" : "−") + fmtMs(Math.abs(p.cell.latencyDelta)) : "—"}</td>
      </tr>`;
    })
    .join("\n");

  const costTotals = `<tr class="totals">
    <td>total</td>
    <td class="r">${fmtUsd(summary.totalCostA)}</td>
    <td class="r">${fmtUsd(summary.totalCostB)}</td>
    <td class="r" colspan="5"></td>
  </tr>`;

  const panels = report.pairs
    .map((p) => renderPanel(p, aTargetId, bTargetId))
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lockstep — ${esc(aTargetId)} vs ${esc(bTargetId)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand">◧ lockstep <span class="brand-sub">prompt-CI</span></div>
  <h1>${esc(aTargetId)} <span class="vs">vs</span> ${esc(bTargetId)}</h1>
  <p class="verdict">${esc(verdict)}</p>
  <div class="sub">
    <span class="pill pill-a">A · ${esc(aTargetId)} <span class="muted">${esc(aModel)}</span></span>
    <span class="pill pill-b">B · ${esc(bTargetId)} <span class="muted">${esc(bModel)}</span></span>
    <span class="muted small">drift threshold ${(report.similarityThreshold * 100).toFixed(0)}% similarity</span>
  </div>
</header>

<main>
  <section>${summaryCards}</section>

  <section>
    <h2>Verdict per case</h2>
    <div class="table-wrap">
    <table>
      <thead><tr><th>case</th><th>status</th><th class="r">similarity</th><th>best target</th></tr></thead>
      <tbody>${verdictRows}</tbody>
    </table>
    </div>
  </section>

  <section>
    <h2>Cost &amp; latency per task</h2>
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th>case</th>
        <th class="r">cost A</th><th class="r">cost B</th><th class="r">Δ cost</th><th class="r">Δ %</th>
        <th class="r">lat A</th><th class="r">lat B</th><th class="r">Δ lat</th>
      </tr></thead>
      <tbody>${costRows}${costTotals}</tbody>
    </table>
    </div>
  </section>

  <section>
    <h2>Before / after</h2>
    ${panels}
  </section>
</main>

<footer>
  Generated with <strong>lockstep</strong> · open-source prompt-CI · ${esc(report.generatedAt ?? "")}
</footer>
</div>

<script>${JS}</script>
</body>
</html>`;
}

function renderResultMeta(r: CaseResult | undefined): string {
  if (!r) return `<span class="muted">missing</span>`;
  if (r.status === "BROKEN") {
    return `<span class="badge badge-broken">BROKEN</span> <span class="muted">${esc(r.error ?? "")}</span>`;
  }
  const judge =
    r.judge !== undefined
      ? ` · judge <strong>${r.judge.score.toFixed(2)}</strong>`
      : "";
  const assert =
    r.assertions && r.assertions.length
      ? r.assertionsPass
        ? ` · <span class="ok-text">assertions ✓</span>`
        : ` · <span class="bad-text">assertions ✗</span>`
      : "";
  return `${r.tokensIn}/${r.tokensOut} tok · ${fmtMs(r.latencyMs)} · ${fmtUsd(r.cost)}${assert}${judge}`;
}

function renderPanel(
  p: PairedResult,
  aTargetId: string,
  bTargetId: string
): string {
  const diff =
    p.a && p.b && p.a.status === "OK" && p.b.status === "OK"
      ? wordDiff(p.a.output, p.b.output)
      : {
          a: esc(p.a?.output ?? p.a?.error ?? ""),
          b: esc(p.b?.output ?? p.b?.error ?? ""),
        };
  const badges = p.cell
    ? p.cell.statuses.map(statusBadge).join(" ")
    : statusBadge("BROKEN");
  const judgeReason =
    p.b?.judge?.reason || p.a?.judge?.reason
      ? `<div class="judge-reason">judge: ${esc(p.b?.judge?.reason ?? p.a?.judge?.reason ?? "")}</div>`
      : "";
  const sim =
    p.cell !== undefined
      ? `<span class="muted small">${(p.cell.similarity * 100).toFixed(0)}% similar</span>`
      : "";

  return `<div class="panel">
    <div class="panel-head">
      <span class="case"><strong>${esc(p.caseId)}</strong><span class="muted">#${p.inputIndex}</span></span>
      <span class="panel-badges">${badges} ${sim}</span>
    </div>
    <div class="cols">
      <div class="col">
        <div class="col-head"><span class="pill pill-a">A · ${esc(aTargetId)}</span> <span class="meta">${renderResultMeta(p.a)}</span></div>
        <pre class="out">${diff.a}</pre>
      </div>
      <div class="col">
        <div class="col-head"><span class="pill pill-b">B · ${esc(bTargetId)}</span> <span class="meta">${renderResultMeta(p.b)}</span></div>
        <pre class="out">${diff.b}</pre>
      </div>
    </div>
    ${judgeReason}
  </div>`;
}

const CSS = `
:root{
  --bg:#f6f7f9; --surface:#ffffff; --ink:#1a1f29; --ink-soft:#5b6573; --line:#e4e7ec;
  --a:#2563eb; --a-soft:#eff4ff; --b:#7c3aed; --b-soft:#f5f0ff;
  --ok:#0f9d58; --ok-soft:#e8f6ee; --drift:#c47d00; --drift-soft:#fbf2dd;
  --broken:#d92d20; --broken-soft:#fdecea; --add:#d6f3e0; --rm:#fbe0de;
  --shadow:0 1px 2px rgba(16,24,40,.04),0 4px 16px rgba(16,24,40,.06);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px 64px;}

header{padding:48px 0 28px;}
.brand{font-weight:700;letter-spacing:-.01em;color:var(--ink);font-size:15px;}
.brand-sub{color:var(--ink-soft);font-weight:500;margin-left:2px;}
h1{margin:18px 0 8px;font-size:clamp(28px,5vw,42px);font-weight:800;letter-spacing:-.025em;line-height:1.1;}
h1 .vs{color:var(--ink-soft);font-weight:500;font-size:.6em;}
.verdict{margin:4px 0 18px;font-size:clamp(16px,2.4vw,19px);color:var(--ink);font-weight:600;letter-spacing:-.01em;}
.sub{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.muted{color:var(--ink-soft);font-weight:400;}
.small{font-size:13px;}
.pill{display:inline-flex;gap:6px;align-items:center;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:600;border:1px solid var(--line);background:var(--surface);}
.pill-a{color:var(--a);border-color:#cfe0ff;background:var(--a-soft);}
.pill-b{color:var(--b);border-color:#e3d6ff;background:var(--b-soft);}

main{display:flex;flex-direction:column;gap:40px;}
section{display:flex;flex-direction:column;gap:14px;}
h2{margin:0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-soft);}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:var(--shadow);}
.card .num{font-size:26px;font-weight:800;letter-spacing:-.02em;}
.card .num .arrow{color:var(--ink-soft);font-weight:500;}
.card .lbl{color:var(--ink-soft);font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-top:4px;}
.card.ok .num{color:var(--ok);} .card.drift .num{color:var(--drift);} .card.broken .num{color:var(--broken);}

.table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);}
table{width:100%;border-collapse:collapse;font-size:14px;}
th,td{text-align:left;padding:12px 16px;border-bottom:1px solid var(--line);white-space:nowrap;}
tr:last-child td{border-bottom:none;}
thead th{color:var(--ink-soft);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.06em;background:#fafbfc;}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums;}
td.case{font-weight:600;}
td.case .muted{font-weight:400;margin-left:2px;}
td.best{color:var(--ink);}
td.pos{color:var(--ok);} td.neg{color:var(--broken);}
tr.totals td{font-weight:700;background:#fafbfc;border-top:2px solid var(--line);}

.badge{display:inline-block;padding:3px 9px;border-radius:7px;font-size:11px;font-weight:700;letter-spacing:.02em;}
.badge-ok{background:var(--ok-soft);color:var(--ok);}
.badge-drifted{background:var(--drift-soft);color:var(--drift);}
.badge-broken{background:var(--broken-soft);color:var(--broken);}
.badge-cheaper{background:var(--a-soft);color:var(--a);}
.badge-pricier{background:var(--drift-soft);color:var(--drift);}
.badge-faster{background:var(--ok-soft);color:var(--ok);}
.badge-slower{background:var(--drift-soft);color:var(--drift);}

.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:16px;}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);background:#fafbfc;flex-wrap:wrap;}
.panel-head .case strong{font-size:15px;}
.panel-head .case .muted{margin-left:3px;}
.panel-badges{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.cols{display:grid;grid-template-columns:1fr 1fr;}
.col{padding:16px 18px;min-width:0;}
.col:first-child{border-right:1px solid var(--line);}
.col-head{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;}
.col-head .meta{font-size:12px;color:var(--ink-soft);}
.out{white-space:pre-wrap;word-break:break-word;margin:0;
  font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:#fbfcfd;border:1px solid var(--line);border-radius:9px;padding:12px;
  max-height:380px;overflow:auto;color:#2b313b;}
.out .add{background:var(--add);border-radius:3px;padding:0 1px;}
.out .rm{background:var(--rm);border-radius:3px;padding:0 1px;}
.ok-text{color:var(--ok);font-weight:600;} .bad-text{color:var(--broken);font-weight:600;}
.judge-reason{padding:10px 18px;border-top:1px solid var(--line);font-size:13px;color:var(--ink-soft);font-style:italic;background:#fafbfc;}

footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--ink-soft);font-size:13px;}

@media (max-width:680px){
  .cols{grid-template-columns:1fr;}
  .col:first-child{border-right:none;border-bottom:1px solid var(--line);}
  header{padding:32px 0 20px;}
}
`;

const JS = `
// Toggle word-diff highlight on/off for clean screenshots (press "d").
document.addEventListener('keydown',function(e){
  if(e.key==='d'){document.body.classList.toggle('no-diff');}
});
`;

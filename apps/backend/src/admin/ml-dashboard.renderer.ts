/**
 * Pure HTML renderer for `/admin/ml-status/dashboard`.
 *
 * Zero-runtime, zero-CDN: every byte the operator's browser receives is
 * generated server-side here so the dashboard works on a locked-down
 * Content-Security-Policy (no `<script src="…">`, no external fonts, no
 * Chart.js). Charts are inline SVG.
 *
 * SECURITY: every dynamic value funneled into HTML MUST go through
 * `escapeHtml`. Job names, error messages, and the raw `metadata`
 * payload originate from the ML scripts and could in principle contain
 * `<script>` tags or attribute breakers. OWASP A03:2021 — Injection.
 */
import type { MlJobSummary, MlStatusResponse } from './ml-status.service';

export interface MaeHistoryPoint {
  /** ISO date (YYYY-MM-DD) of the bucket. */
  date: string;
  /** Mean absolute error of `predicted_occupancy` vs realized
   * `occupancy_rate`, both on the [0,1] scale. NaN if no samples. */
  mae: number;
  sampleCount: number;
}

export interface LotEwmaSummary {
  lotId: string;
  lotCode: string;
  totalBuckets: number;
  blendableBuckets: number;
  /** ISO timestamp of the freshest cell, or null if no cells yet. */
  lastUpdatedAt: string | null;
  /** Mean ewmaValue across all cells (0..1), or null if empty. */
  meanEwma: number | null;
}

export interface ModelVersionInfo {
  horizon: 'short_term' | 'long_term';
  /** Most recent successful predict run version, or null if never run. */
  modelVersion: string | null;
  lastSuccessAt: string | null;
}

export interface DashboardData {
  status: MlStatusResponse;
  maeHistory: MaeHistoryPoint[];
  ewmaLots: LotEwmaSummary[];
  modelVersions: ModelVersionInfo[];
  /** True iff the synthetic-vs-real overlay PNG exists on disk and can
   * be fetched at /admin/ml-status/synthetic-overlay.png. */
  syntheticOverlayAvailable: boolean;
  /** When the overlay PNG was last regenerated (mtime). */
  syntheticOverlayGeneratedAt: string | null;
}

/**
 * HTML-escape arbitrary text for safe inclusion in element bodies and
 * double-quoted attributes. Five-char escape; sufficient because all
 * dynamic values go into either a text node or an attribute value (no
 * inline JS, no URL contexts).
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: '#198754',
  FAILED: '#dc3545',
  SKIPPED: '#6c757d',
  RUNNING: '#0d6efd',
};

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMae(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return n.toFixed(4);
}

function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtRelative(iso: string | null, now: number): string {
  if (iso === null) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return escapeHtml(iso);
  const diff = now - t;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function renderJobRow(job: MlJobSummary, now: number): string {
  const successColor = job.successRate >= 0.95
    ? '#198754'
    : job.successRate >= 0.8
      ? '#fd7e14'
      : '#dc3545';
  return `<tr>
  <td><code>${escapeHtml(job.jobName)}</code></td>
  <td>${job.total}</td>
  <td><span style="color:${STATUS_COLOR.SUCCESS}">${job.successCount}</span></td>
  <td><span style="color:${STATUS_COLOR.FAILED}">${job.failedCount}</span></td>
  <td><span style="color:${STATUS_COLOR.SKIPPED}">${job.skippedCount}</span></td>
  <td><span style="color:${STATUS_COLOR.RUNNING}">${job.runningCount}</span></td>
  <td><strong style="color:${successColor}">${fmtPct(job.successRate)}</strong></td>
  <td>${fmtRelative(job.lastSuccessAt, now)}</td>
  <td>${fmtRelative(job.lastFailureAt, now)}</td>
  <td class="err">${escapeHtml(job.lastFailureMessage ?? '')}</td>
</tr>`;
}

function renderRecentRunsTimeline(status: MlStatusResponse): string {
  // Per-job timeline: last N runs as colored squares, oldest left → newest right.
  // Group by job name, render each group as one row.
  const grouped = new Map<string, MlStatusResponse['recentRuns']>();
  for (const run of status.recentRuns) {
    const list = grouped.get(run.jobName) ?? [];
    list.push(run);
    grouped.set(run.jobName, list);
  }
  const rows: string[] = [];
  const jobNames = Array.from(grouped.keys()).sort();
  for (const job of jobNames) {
    const runs = (grouped.get(job) ?? []).slice().reverse(); // oldest first
    const cells = runs
      .map((r) => {
        const color = STATUS_COLOR[r.status] ?? '#999';
        const label = `${r.startedAt} ${r.status}${r.errorMessage ? ' — ' + r.errorMessage : ''}`;
        return `<span class="run-cell" style="background:${color}" title="${escapeHtml(label)}"></span>`;
      })
      .join('');
    rows.push(
      `<tr><td><code>${escapeHtml(job)}</code></td><td class="timeline">${cells}</td><td>${runs.length}</td></tr>`,
    );
  }
  if (rows.length === 0) {
    return '<p class="muted">No recent runs in the selected window.</p>';
  }
  return `<table class="data">
  <thead><tr><th>Job</th><th>Timeline (oldest → newest)</th><th>N</th></tr></thead>
  <tbody>${rows.join('')}</tbody>
</table>`;
}

function renderMaeChart(points: MaeHistoryPoint[]): string {
  if (points.length === 0) {
    return '<p class="muted">No MAE history yet — the dashboard joins recent <code>predictions_short_term</code> rows to <code>occupancy_snapshots</code>; predictions need at least one fully-realized target_time to score.</p>';
  }
  const W = 720;
  const H = 200;
  const PAD_L = 48;
  const PAD_B = 28;
  const PAD_T = 16;
  const PAD_R = 16;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const maes = points.map((p) => p.mae).filter((v) => Number.isFinite(v));
  const maxMae = maes.length > 0 ? Math.max(...maes, 0.05) : 0.5;
  const yMax = Math.ceil(maxMae * 20) / 20; // round up to nearest 0.05
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;

  const dots: string[] = [];
  const linePts: string[] = [];
  points.forEach((p, i) => {
    if (!Number.isFinite(p.mae)) return;
    const x = PAD_L + i * stepX;
    const y = PAD_T + (1 - p.mae / yMax) * innerH;
    linePts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    dots.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#0d6efd"><title>${escapeHtml(p.date)}: MAE ${fmtMae(p.mae)} (n=${p.sampleCount})</title></circle>`,
    );
  });

  // Axis labels (3 ticks)
  const yTicks: string[] = [];
  for (let i = 0; i <= 3; i++) {
    const v = (yMax * i) / 3;
    const y = PAD_T + (1 - i / 3) * innerH;
    yTicks.push(
      `<text x="${PAD_L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${v.toFixed(2)}</text>` +
        `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#eee"/>`,
    );
  }

  const xLabels: string[] = [];
  const labelStride = Math.max(1, Math.ceil(points.length / 8));
  points.forEach((p, i) => {
    if (i % labelStride !== 0 && i !== points.length - 1) return;
    const x = PAD_L + i * stepX;
    xLabels.push(
      `<text x="${x.toFixed(1)}" y="${(H - PAD_B + 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="#666">${escapeHtml(p.date.slice(5))}</text>`,
    );
  });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Short-term MAE over time" style="width:100%;max-width:${W}px;height:auto">
  ${yTicks.join('')}
  <polyline fill="none" stroke="#0d6efd" stroke-width="2" points="${linePts.join(' ')}"/>
  ${dots.join('')}
  ${xLabels.join('')}
  <text x="${PAD_L}" y="${PAD_T - 4}" font-size="11" fill="#333">MAE (0..1, lower=better) — short_term predictions vs realized occupancy_rate</text>
</svg>`;
}

function renderModelVersions(versions: ModelVersionInfo[], now: number): string {
  if (versions.length === 0) return '<p class="muted">No model_version observations yet.</p>';
  return `<table class="data">
  <thead><tr><th>Horizon</th><th>Latest model_version</th><th>Last success</th></tr></thead>
  <tbody>${versions
    .map(
      (v) =>
        `<tr><td><code>${escapeHtml(v.horizon)}</code></td><td><code>${escapeHtml(v.modelVersion ?? '–')}</code></td><td>${fmtRelative(v.lastSuccessAt, now)}</td></tr>`,
    )
    .join('')}</tbody>
</table>`;
}

function renderEwmaLots(lots: LotEwmaSummary[], now: number): string {
  if (lots.length === 0) {
    return '<p class="muted">No <code>penetration_rate_estimates</code> rows yet — run the <code>recompute-penetration-rates</code> cron at least once.</p>';
  }
  const rows = lots
    .map((lot) => {
      const blendPct = lot.totalBuckets === 0 ? 0 : lot.blendableBuckets / lot.totalBuckets;
      const blendColor = blendPct >= 0.5 ? '#198754' : blendPct >= 0.2 ? '#fd7e14' : '#dc3545';
      return `<tr>
  <td><a href="/api/admin/penetration-rate/${escapeHtml(lot.lotCode)}"><code>${escapeHtml(lot.lotCode)}</code></a></td>
  <td>${lot.totalBuckets}</td>
  <td><strong style="color:${blendColor}">${lot.blendableBuckets}</strong> (${fmtPct(blendPct)})</td>
  <td>${lot.meanEwma === null ? '–' : lot.meanEwma.toFixed(4)}</td>
  <td>${fmtRelative(lot.lastUpdatedAt, now)}</td>
</tr>`;
    })
    .join('');
  return `<table class="data scrollable">
  <thead><tr><th>Lot</th><th>Cells</th><th>Blendable</th><th>Mean EWMA</th><th>Freshest cell</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderRecentRunsTable(status: MlStatusResponse, now: number): string {
  if (status.recentRuns.length === 0) return '<p class="muted">No recent runs.</p>';
  const rows = status.recentRuns
    .slice(0, 30)
    .map((r) => {
      const meta = r.metadata === null ? '' : escapeHtml(JSON.stringify(r.metadata));
      return `<tr>
  <td><code>${escapeHtml(r.jobName)}</code></td>
  <td><span class="badge" style="background:${STATUS_COLOR[r.status] ?? '#999'}">${escapeHtml(r.status)}</span></td>
  <td>${fmtRelative(r.startedAt, now)}</td>
  <td>${fmtDuration(r.durationMs)}</td>
  <td class="err">${escapeHtml(r.errorMessage ?? '')}</td>
  <td><code class="meta">${meta}</code></td>
</tr>`;
    })
    .join('');
  return `<table class="data">
  <thead><tr><th>Job</th><th>Status</th><th>Started</th><th>Duration</th><th>Error</th><th>ML_RESULT</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function renderMlDashboard(data: DashboardData): string {
  const now = Date.now();
  const overlay = data.syntheticOverlayAvailable
    ? `<figure>
  <img src="/api/admin/ml-status/synthetic-overlay.png?t=${escapeHtml(data.syntheticOverlayGeneratedAt ?? '')}" alt="Synthetic v2 vs real consensus occupancy" style="max-width:100%;border:1px solid #ccc;background:#fff"/>
  <figcaption class="muted">Generated ${fmtRelative(data.syntheticOverlayGeneratedAt, now)} by <code>scripts/validate_synthetic_v2.py</code>.</figcaption>
</figure>`
    : `<p class="muted">Overlay PNG not available. Run <code>python -m scripts.validate_synthetic_v2 --out apps/backend/public/ml-artifacts/synthetic_overlay.png</code> from <code>services/ml/</code>.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>SharkPark — ML status dashboard</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  body { max-width: 1200px; margin: 0 auto; padding: 16px; line-height: 1.4; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { margin: 24px 0 8px; font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .muted { color: #666; font-size: 13px; }
  table.data { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.data th, table.data td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.data th { background: #f5f5f5; font-weight: 600; }
  table.data.scrollable { display: block; max-height: 480px; overflow-y: auto; }
  table.data td.err { color: #b00; max-width: 280px; word-break: break-word; }
  table.data td .meta, code.meta { font-size: 11px; color: #555; word-break: break-all; }
  .timeline { white-space: nowrap; }
  .run-cell { display: inline-block; width: 10px; height: 18px; margin-right: 1px; vertical-align: middle; border-radius: 1px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; color: #fff; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  header .meta-line { font-size: 12px; color: #666; }
  section { margin-bottom: 8px; }
  figure { margin: 8px 0; }
  a { color: #0d6efd; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #ddd; }
    table.data th { background: #2a2a2a; }
    table.data th, table.data td { border-color: #333; }
    h2 { border-color: #444; }
    .muted { color: #999; }
  }
</style>
</head>
<body>
<header>
  <h1>SharkPark — ML status</h1>
  <div class="meta-line">
    Generated <strong>${escapeHtml(data.status.generatedAt)}</strong> · window <strong>${data.status.windowHours}h</strong> ·
    <a href="?format=json">view JSON</a>
  </div>
</header>

<section>
  <h2>Per-job rollup</h2>
  ${
    data.status.jobs.length === 0
      ? '<p class="muted">No jobs in window.</p>'
      : `<table class="data">
  <thead><tr>
    <th>Job</th><th>Total</th><th>OK</th><th>Fail</th><th>Skip</th><th>Run</th><th>Success rate</th><th>Last success</th><th>Last failure</th><th>Last error</th>
  </tr></thead>
  <tbody>${data.status.jobs.map((j) => renderJobRow(j, now)).join('')}</tbody>
</table>`
  }
</section>

<section>
  <h2>Cron timeline (per-job, oldest → newest)</h2>
  ${renderRecentRunsTimeline(data.status)}
</section>

<section>
  <h2>Latest production model versions</h2>
  ${renderModelVersions(data.modelVersions, now)}
</section>

<section>
  <h2>Short-term MAE over time</h2>
  ${renderMaeChart(data.maeHistory)}
</section>

<section>
  <h2>Penetration-rate EWMA grid (per lot)</h2>
  ${renderEwmaLots(data.ewmaLots, now)}
</section>

<section>
  <h2>Synthetic v2 vs real consensus</h2>
  ${overlay}
</section>

<section>
  <h2>Recent runs (latest 30)</h2>
  ${renderRecentRunsTable(data.status, now)}
</section>

</body>
</html>`;
}

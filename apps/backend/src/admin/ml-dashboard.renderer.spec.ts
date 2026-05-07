import {
  escapeHtml,
  renderMlDashboard,
  type DashboardData,
  type LotEwmaSummary,
  type MaeHistoryPoint,
  type ModelVersionInfo,
} from './ml-dashboard.renderer';
import type { MlStatusResponse } from './ml-status.service';

function emptyStatus(): MlStatusResponse {
  return {
    generatedAt: '2026-05-06T12:00:00.000Z',
    windowHours: 24,
    jobs: [],
    recentRuns: [],
  };
}

function makeData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    status: emptyStatus(),
    maeHistory: [],
    ewmaLots: [],
    modelVersions: [],
    syntheticOverlayAvailable: false,
    syntheticOverlayGeneratedAt: null,
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it.each([
    ['<script>', '&lt;script&gt;'],
    ['"&"', '&quot;&amp;&quot;'],
    ["'/>", '&#39;/&gt;'],
    [null, ''],
    [undefined, ''],
    [42, '42'],
  ])('escapes %p → %p', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });
});

describe('renderMlDashboard', () => {
  it('renders a valid HTML5 document with the expected sections', () => {
    const html = renderMlDashboard(makeData());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>SharkPark — ML status dashboard</title>');
    expect(html).toContain('Per-job rollup');
    expect(html).toContain('Cron timeline');
    expect(html).toContain('Latest production model versions');
    expect(html).toContain('Short-term MAE over time');
    expect(html).toContain('Penetration-rate EWMA grid');
    expect(html).toContain('Synthetic v2 vs real consensus');
    expect(html).toContain('Recent runs');
  });

  it('escapes job names, error messages, and metadata to prevent XSS', () => {
    const status: MlStatusResponse = {
      generatedAt: '2026-05-06T12:00:00.000Z',
      windowHours: 24,
      jobs: [
        {
          jobName: '<script>alert(1)</script>',
          total: 1,
          successCount: 0,
          failedCount: 1,
          skippedCount: 0,
          runningCount: 0,
          successRate: 0,
          lastRunAt: '2026-05-06T11:00:00.000Z',
          lastSuccessAt: null,
          lastFailureAt: '2026-05-06T11:00:00.000Z',
          lastFailureMessage: '"><img src=x onerror=alert(2)>',
        },
      ],
      recentRuns: [
        {
          id: '1',
          jobName: '<script>alert(3)</script>',
          startedAt: '2026-05-06T11:00:00.000Z',
          completedAt: '2026-05-06T11:00:05.000Z',
          status: 'FAILED',
          durationMs: 5000,
          errorMessage: '<img src=x onerror=alert(4)>',
          metadata: { evil: '</script><script>alert(5)</script>' },
        },
      ],
    };
    const html = renderMlDashboard(makeData({ status }));
    // Raw payloads must NOT appear unescaped anywhere.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(3)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).not.toContain('<img src=x onerror=alert(4)>');
    expect(html).not.toContain('</script><script>alert(5)</script>');
    // But the escaped form must.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
  });

  it('renders MAE points as inline SVG with one circle per finite point', () => {
    const maeHistory: MaeHistoryPoint[] = [
      { date: '2026-05-01', mae: 0.10, sampleCount: 100 },
      { date: '2026-05-02', mae: 0.08, sampleCount: 110 },
      { date: '2026-05-03', mae: 0.12, sampleCount: 95 },
    ];
    const html = renderMlDashboard(makeData({ maeHistory }));
    expect(html).toContain('<svg ');
    // 3 dots
    expect(html.match(/<circle /g)?.length).toBe(3);
    // tooltip text contains the date+mae
    expect(html).toContain('2026-05-02: MAE 0.0800');
  });

  it('renders the EWMA per-lot table with blendable counts and links', () => {
    const ewmaLots: LotEwmaSummary[] = [
      {
        lotId: 'cuid-1',
        lotCode: 'G1',
        totalBuckets: 72,
        blendableBuckets: 36,
        meanEwma: 0.18,
        lastUpdatedAt: '2026-05-06T02:30:00.000Z',
      },
    ];
    const html = renderMlDashboard(makeData({ ewmaLots }));
    expect(html).toContain('href="/api/admin/penetration-rate/G1"');
    expect(html).toContain('>36<'); // blendable count
    expect(html).toContain('0.1800'); // mean ewma rounded display
  });

  it('shows model versions or a placeholder', () => {
    const modelVersions: ModelVersionInfo[] = [
      {
        horizon: 'short_term',
        modelVersion: 'v42',
        lastSuccessAt: '2026-05-06T11:00:00.000Z',
      },
      {
        horizon: 'long_term',
        modelVersion: null,
        lastSuccessAt: null,
      },
    ];
    const html = renderMlDashboard(makeData({ modelVersions }));
    expect(html).toContain('v42');
    expect(html).toContain('long_term');
    expect(html).toContain('never');
  });

  it('toggles the synthetic-overlay figure based on availability', () => {
    const off = renderMlDashboard(makeData({ syntheticOverlayAvailable: false }));
    expect(off).toContain('Overlay PNG not available');
    expect(off).not.toContain('<img src="/api/admin/ml-status/synthetic-overlay.png');

    const on = renderMlDashboard(
      makeData({
        syntheticOverlayAvailable: true,
        syntheticOverlayGeneratedAt: '2026-05-06T03:00:00.000Z',
      }),
    );
    expect(on).toContain('<img src="/api/admin/ml-status/synthetic-overlay.png?t=2026-05-06T03:00:00.000Z"');
  });
});

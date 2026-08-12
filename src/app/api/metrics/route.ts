import { NextResponse } from 'next/server';
import { ensureReady } from '@/lib/bootstrap';
import { addDays, today } from '@/lib/dates';
import { allMetrics, bestLag, correlate, getSeries, resolveMetric, smooth, zScore } from '@/lib/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/metrics
 *   ?ids=a,b,c      metric ids from the catalog (required)
 *   &from=&to=      day range (defaults to the last 90 days)
 *   &smooth=N       centred rolling mean window in days
 *   &normalize=1    z-score each series onto a shared scale
 *   &correlate=1    include a pairwise correlation matrix with best lag
 *
 * GET /api/metrics?catalog=1 returns the metric catalog.
 */
export async function GET(request: Request) {
  await ensureReady();

  const url = new URL(request.url);

  if (url.searchParams.get('catalog')) {
    return NextResponse.json({
      metrics: allMetrics().map(({ sql: _sql, ...rest }) => rest),
    });
  }

  const ids = (url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }

  const to = url.searchParams.get('to') ?? today();
  const from = url.searchParams.get('from') ?? addDays(to, -89);
  const smoothWindow = Number(url.searchParams.get('smooth') ?? 1) || 1;
  const normalize = url.searchParams.get('normalize') === '1';

  const series = ids.map((id) => {
    const def = resolveMetric(id);
    const raw = getSeries(id, from, to);
    const points = smooth(raw.points, smoothWindow);
    return {
      id,
      label: def?.label ?? id,
      unit: def?.unit ?? '',
      dp: def?.dp ?? 1,
      domain: def?.domain ?? 'Training',
      shape: def?.shape ?? 'line',
      better: def?.better ?? 'neutral',
      description: def?.description ?? '',
      points: normalize ? zScore(points) : points,
      rawPoints: points,
    };
  });

  const body: Record<string, unknown> = { from, to, normalized: normalize, series };

  if (url.searchParams.get('correlate') && series.length >= 2) {
    const pairs = [];
    for (let i = 0; i < series.length; i++) {
      for (let j = i + 1; j < series.length; j++) {
        const a = series[i];
        const b = series[j];
        pairs.push({
          a: a.id,
          b: b.id,
          aLabel: a.label,
          bLabel: b.label,
          sameDay: correlate(a.rawPoints, b.rawPoints, 0),
          best: bestLag(a.rawPoints, b.rawPoints, 7),
        });
      }
    }
    body.correlations = pairs;
  }

  return NextResponse.json(body);
}

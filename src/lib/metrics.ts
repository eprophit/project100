import { all } from './db';
import type { DayKey } from './dates';
import type { Point, Series } from './types';

/**
 * The metric catalog is the single vocabulary shared by the overlay charts, the
 * correlation tool and the LLM's `query_metric` tool. Adding a metric here makes
 * it available in all three at once.
 */

export type MetricDomain =
  | 'Training'
  | 'Sleep'
  | 'Recovery'
  | 'Nutrition'
  | 'Body'
  | 'Protocols'
  | 'Labs';

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  domain: MetricDomain;
  /** Whether a higher value is the desirable direction. */
  better: 'up' | 'down' | 'neutral';
  /** How to render: continuous line, or sparse markers for episodic data. */
  shape: 'line' | 'bar' | 'scatter';
  description: string;
  /** Must return rows of `{ day, value }` for a `?`-bounded date range. */
  sql: string;
  /** Decimal places for display. */
  dp: number;
}

const daily = (sql: string) => sql;

export const METRICS: MetricDef[] = [
  // --- Training ------------------------------------------------------------
  {
    id: 'training.load',
    label: 'Training load',
    unit: 'au',
    domain: 'Training',
    better: 'neutral',
    shape: 'bar',
    dp: 0,
    description: 'Sum of all session loads for the day (duration × relative intensity²).',
    sql: daily(`SELECT day, SUM(load) AS value FROM workouts WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'training.duration',
    label: 'Training time',
    unit: 'min',
    domain: 'Training',
    better: 'neutral',
    shape: 'bar',
    dp: 0,
    description: 'Total training minutes across all modalities.',
    sql: daily(`SELECT day, SUM(duration_s)/60.0 AS value FROM workouts WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'training.acute',
    label: 'Acute load (7d)',
    unit: 'au',
    domain: 'Training',
    better: 'neutral',
    shape: 'line',
    dp: 1,
    description: '7-day rolling average of daily load — short-term fatigue.',
    // The date spine matters: rest days must count as zero-load days, otherwise
    // the window averages over training sessions instead of calendar days.
    sql: daily(`
      WITH RECURSIVE cal(day) AS (
        SELECT MIN(day) FROM workouts
        UNION ALL
        SELECT date(day, '+1 day') FROM cal WHERE day < date('now')
      ),
      d AS (
        SELECT cal.day AS day,
               COALESCE((SELECT SUM(load) FROM workouts w WHERE w.day = cal.day), 0) AS load
        FROM cal
      ),
      rolled AS (
        SELECT day, AVG(load) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS value
        FROM d
      )
      -- The filter has to sit outside the window, or SQLite applies WHERE first
      -- and the frame only sees the requested range instead of the history.
      SELECT day, value FROM rolled WHERE day BETWEEN ? AND ?`),
  },
  {
    id: 'training.chronic',
    label: 'Chronic load (28d)',
    unit: 'au',
    domain: 'Training',
    better: 'up',
    shape: 'line',
    dp: 1,
    description: '28-day rolling average of daily load — accumulated fitness.',
    sql: daily(`
      WITH RECURSIVE cal(day) AS (
        SELECT MIN(day) FROM workouts
        UNION ALL
        SELECT date(day, '+1 day') FROM cal WHERE day < date('now')
      ),
      d AS (
        SELECT cal.day AS day,
               COALESCE((SELECT SUM(load) FROM workouts w WHERE w.day = cal.day), 0) AS load
        FROM cal
      ),
      rolled AS (
        SELECT day, AVG(load) OVER (ORDER BY day ROWS BETWEEN 27 PRECEDING AND CURRENT ROW) AS value
        FROM d
      )
      -- The filter has to sit outside the window, or SQLite applies WHERE first
      -- and the frame only sees the requested range instead of the history.
      SELECT day, value FROM rolled WHERE day BETWEEN ? AND ?`),
  },
  {
    id: 'training.distance',
    label: 'Distance',
    unit: 'km',
    domain: 'Training',
    better: 'neutral',
    shape: 'bar',
    dp: 1,
    description: 'Total distance covered across all modalities.',
    sql: daily(`SELECT day, SUM(distance_m)/1000.0 AS value FROM workouts WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'row.pace',
    label: 'Rowing pace',
    unit: 's/500m',
    domain: 'Training',
    better: 'down',
    shape: 'scatter',
    dp: 1,
    description: 'Average split for the session, in seconds per 500 m. Lower is faster.',
    sql: daily(`SELECT day, AVG(pace_s) AS value FROM workouts
                WHERE modality='rowing' AND pace_s IS NOT NULL AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'row.watts',
    label: 'Rowing power',
    unit: 'W',
    domain: 'Training',
    better: 'up',
    shape: 'scatter',
    dp: 0,
    description: 'Average watts on the erg.',
    sql: daily(`SELECT day, AVG(avg_watts) AS value FROM workouts
                WHERE modality='rowing' AND avg_watts IS NOT NULL AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'bike.watts',
    label: 'Cycling power',
    unit: 'W',
    domain: 'Training',
    better: 'up',
    shape: 'scatter',
    dp: 0,
    description: 'Average watts on the bike.',
    sql: daily(`SELECT day, AVG(avg_watts) AS value FROM workouts
                WHERE modality='cycling' AND avg_watts IS NOT NULL AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'run.pace',
    label: 'Running pace',
    unit: 's/km',
    domain: 'Training',
    better: 'down',
    shape: 'scatter',
    dp: 0,
    description: 'Average pace in seconds per kilometre. Lower is faster.',
    sql: daily(`SELECT day, AVG(pace_s) AS value FROM workouts
                WHERE modality='running' AND pace_s IS NOT NULL AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'strength.volume',
    label: 'Lifting volume',
    unit: 'kg',
    domain: 'Training',
    better: 'up',
    shape: 'bar',
    dp: 0,
    description: 'Total tonnage moved (reps × load) in strength sessions.',
    sql: daily(`SELECT w.day, SUM(s.reps * s.weight_kg) AS value
                FROM strength_sets s JOIN workouts w ON w.id = s.workout_id
                WHERE w.day BETWEEN ? AND ? GROUP BY w.day`),
  },
  {
    id: 'training.avg_hr',
    label: 'Session avg HR',
    unit: 'bpm',
    domain: 'Training',
    better: 'neutral',
    shape: 'scatter',
    dp: 0,
    description: 'Mean heart rate across the day’s sessions.',
    sql: daily(`SELECT day, AVG(avg_hr) AS value FROM workouts
                WHERE avg_hr IS NOT NULL AND day BETWEEN ? AND ? GROUP BY day`),
  },

  // --- Sleep ---------------------------------------------------------------
  {
    id: 'sleep.duration',
    label: 'Sleep duration',
    unit: 'h',
    domain: 'Sleep',
    better: 'up',
    shape: 'line',
    dp: 2,
    description: 'Total time asleep, excluding awake periods.',
    sql: daily(`SELECT day, AVG(total_min)/60.0 AS value FROM sleep WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'sleep.deep',
    label: 'Deep sleep',
    unit: 'min',
    domain: 'Sleep',
    better: 'up',
    shape: 'line',
    dp: 0,
    description: 'Slow-wave sleep minutes.',
    sql: daily(`SELECT day, AVG(deep_min) AS value FROM sleep WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'sleep.rem',
    label: 'REM sleep',
    unit: 'min',
    domain: 'Sleep',
    better: 'up',
    shape: 'line',
    dp: 0,
    description: 'REM sleep minutes.',
    sql: daily(`SELECT day, AVG(rem_min) AS value FROM sleep WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'sleep.efficiency',
    label: 'Sleep efficiency',
    unit: '%',
    domain: 'Sleep',
    better: 'up',
    shape: 'line',
    dp: 1,
    description: 'Asleep time as a share of time in bed.',
    sql: daily(`SELECT day, AVG(efficiency) AS value FROM sleep WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'sleep.resp_rate',
    label: 'Respiratory rate',
    unit: 'br/min',
    domain: 'Sleep',
    better: 'neutral',
    shape: 'line',
    dp: 1,
    description: 'Overnight breathing rate — elevations often precede illness.',
    sql: daily(`SELECT day, AVG(respiratory_rate) AS value FROM sleep WHERE day BETWEEN ? AND ? GROUP BY day`),
  },

  // --- Recovery ------------------------------------------------------------
  {
    id: 'recovery.hrv',
    label: 'HRV (rMSSD)',
    unit: 'ms',
    domain: 'Recovery',
    better: 'up',
    shape: 'line',
    dp: 1,
    description: 'Morning heart-rate variability, root mean square of successive differences.',
    sql: daily(`SELECT day, AVG(hrv_rmssd) AS value FROM recovery WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'recovery.hrv_ln',
    label: 'HRV (ln rMSSD)',
    unit: 'ln ms',
    domain: 'Recovery',
    better: 'up',
    shape: 'line',
    dp: 2,
    description: 'Log-transformed HRV — the form usually used for trend analysis.',
    sql: daily(`SELECT day, AVG(hrv_ln) AS value FROM recovery WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'recovery.rhr',
    label: 'Resting HR',
    unit: 'bpm',
    domain: 'Recovery',
    better: 'down',
    shape: 'line',
    dp: 1,
    description: 'Morning resting heart rate.',
    sql: daily(`SELECT day, AVG(resting_hr) AS value FROM recovery WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'recovery.readiness',
    label: 'Readiness',
    unit: 'score',
    domain: 'Recovery',
    better: 'up',
    shape: 'line',
    dp: 0,
    description: 'Composite readiness score from HRV4Training.',
    sql: daily(`SELECT day, AVG(readiness) AS value FROM recovery WHERE day BETWEEN ? AND ? GROUP BY day`),
  },

  // --- Nutrition -----------------------------------------------------------
  {
    id: 'nutrition.kcal',
    label: 'Energy intake',
    unit: 'kcal',
    domain: 'Nutrition',
    better: 'neutral',
    shape: 'bar',
    dp: 0,
    description: 'Total calories logged.',
    sql: daily(`SELECT day, SUM(kcal) AS value FROM nutrition_entries
                WHERE planned = 0 AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'nutrition.protein',
    label: 'Protein',
    unit: 'g',
    domain: 'Nutrition',
    better: 'up',
    shape: 'bar',
    dp: 0,
    description: 'Total protein logged.',
    sql: daily(`SELECT day, SUM(protein_g) AS value FROM nutrition_entries
                WHERE planned = 0 AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'nutrition.carbs',
    label: 'Carbohydrate',
    unit: 'g',
    domain: 'Nutrition',
    better: 'neutral',
    shape: 'bar',
    dp: 0,
    description: 'Total carbohydrate logged.',
    sql: daily(`SELECT day, SUM(carbs_g) AS value FROM nutrition_entries
                WHERE planned = 0 AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'nutrition.fat',
    label: 'Fat',
    unit: 'g',
    domain: 'Nutrition',
    better: 'neutral',
    shape: 'bar',
    dp: 0,
    description: 'Total fat logged.',
    sql: daily(`SELECT day, SUM(fat_g) AS value FROM nutrition_entries
                WHERE planned = 0 AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'nutrition.fiber',
    label: 'Fibre',
    unit: 'g',
    domain: 'Nutrition',
    better: 'up',
    shape: 'bar',
    dp: 0,
    description: 'Total fibre logged.',
    sql: daily(`SELECT day, SUM(fiber_g) AS value FROM nutrition_entries
                WHERE planned = 0 AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'nutrition.sodium',
    label: 'Sodium',
    unit: 'mg',
    domain: 'Nutrition',
    better: 'down',
    shape: 'bar',
    dp: 0,
    description: 'Total sodium logged.',
    sql: daily(`SELECT day, SUM(sodium_mg) AS value FROM nutrition_entries
                WHERE planned = 0 AND day BETWEEN ? AND ? GROUP BY day`),
  },

  // --- Body ----------------------------------------------------------------
  {
    id: 'body.weight',
    label: 'Body weight',
    unit: 'kg',
    domain: 'Body',
    better: 'neutral',
    shape: 'line',
    dp: 2,
    description: 'Morning body weight.',
    sql: daily(`SELECT day, AVG(weight_kg) AS value FROM body_metrics WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'body.bodyfat',
    label: 'Body fat',
    unit: '%',
    domain: 'Body',
    better: 'down',
    shape: 'line',
    dp: 1,
    description: 'Bio-impedance body-fat estimate.',
    sql: daily(`SELECT day, AVG(bodyfat_pct) AS value FROM body_metrics WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'body.lean',
    label: 'Lean mass',
    unit: 'kg',
    domain: 'Body',
    better: 'up',
    shape: 'line',
    dp: 2,
    description: 'Weight minus fat mass.',
    sql: daily(`SELECT day, AVG(lean_mass_kg) AS value FROM body_metrics WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'body.vo2max',
    label: 'VO₂ max',
    unit: 'ml/kg/min',
    domain: 'Body',
    better: 'up',
    shape: 'line',
    dp: 1,
    description: 'Estimated aerobic capacity from the watch.',
    sql: daily(`SELECT day, AVG(vo2max) AS value FROM body_metrics WHERE day BETWEEN ? AND ? GROUP BY day`),
  },

  // --- Protocols -----------------------------------------------------------
  {
    id: 'protocol.sauna',
    label: 'Sauna',
    unit: 'min',
    domain: 'Protocols',
    better: 'neutral',
    shape: 'bar',
    dp: 0,
    description: 'Sauna minutes logged.',
    sql: daily(`SELECT day, SUM(minutes) AS value FROM protocols
                WHERE kind='sauna' AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'protocol.cold',
    label: 'Cold exposure',
    unit: 'min',
    domain: 'Protocols',
    better: 'neutral',
    shape: 'bar',
    dp: 1,
    description: 'Cold plunge / cold shower minutes logged.',
    sql: daily(`SELECT day, SUM(minutes) AS value FROM protocols
                WHERE kind='cold_plunge' AND day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'protocol.total',
    label: 'All recovery protocols',
    unit: 'min',
    domain: 'Protocols',
    better: 'neutral',
    shape: 'bar',
    dp: 0,
    description: 'Every logged recovery modality, summed.',
    sql: daily(`SELECT day, SUM(minutes) AS value FROM protocols WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
  {
    id: 'supplements.adherence',
    label: 'Supplement adherence',
    unit: '%',
    domain: 'Protocols',
    better: 'up',
    shape: 'line',
    dp: 0,
    description: 'Share of the active supplement stack actually taken.',
    sql: daily(`SELECT day, 100.0 * SUM(taken) / COUNT(*) AS value FROM supplement_logs
                WHERE day BETWEEN ? AND ? GROUP BY day`),
  },
];

const BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export function getMetric(id: string): MetricDef | undefined {
  return BY_ID.get(id);
}

/** Every lab marker present in the DB, exposed as `labs.<slug>` metrics. */
export function labMetrics(): MetricDef[] {
  const rows = all<{ slug: string; name: string; unit: string | null; category: string }>(
    'SELECT DISTINCT slug, name, unit, category FROM biomarkers ORDER BY category, name',
  );
  return rows.map((r) => ({
    id: `labs.${r.slug}`,
    label: r.name,
    unit: r.unit ?? '',
    domain: 'Labs' as const,
    better: 'neutral' as const,
    shape: 'scatter' as const,
    dp: 2,
    description: `${r.category} biomarker from Function Health panels.`,
    sql: '',
  }));
}

export function allMetrics(): MetricDef[] {
  return [...METRICS, ...labMetrics()];
}

export function resolveMetric(id: string): MetricDef | undefined {
  if (id.startsWith('labs.')) return labMetrics().find((m) => m.id === id);
  return BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

/** Always returns a Series; an unknown metric id yields an empty one. */
export function getSeries(metricId: string, from: DayKey, to: DayKey): Series {
  const def = resolveMetric(metricId);
  if (!def) return { metric: metricId, label: metricId, unit: '', points: [] };

  let rows: { day: string; value: number | null }[];

  if (metricId.startsWith('labs.')) {
    const slug = metricId.slice('labs.'.length);
    rows = all<{ day: string; value: number | null }>(
      'SELECT day, AVG(value) AS value FROM biomarkers WHERE slug = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day',
      [slug, from, to],
    );
  } else {
    rows = all<{ day: string; value: number | null }>(`${def.sql} ORDER BY day`, [from, to]);
  }

  const points: Point[] = rows
    .filter((r) => r.value != null && Number.isFinite(r.value))
    .map((r) => ({ day: r.day, value: roundTo(r.value as number, def.dp) }));

  return { metric: def.id, label: def.label, unit: def.unit, points };
}

function roundTo(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------
// Transforms used by the explorer and the correlation tool
// ---------------------------------------------------------------------------

/** Centred rolling mean; `window` of 1 returns the input unchanged. */
export function smooth(points: Point[], window: number): Point[] {
  if (window <= 1 || points.length === 0) return points;
  const half = Math.floor(window / 2);
  return points.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(points.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += points[j].value;
    return { day: points[i].day, value: Math.round((sum / (hi - lo + 1)) * 1000) / 1000 };
  });
}

export function zScore(points: Point[]): Point[] {
  if (points.length < 2) return points.map((p) => ({ ...p, value: 0 }));
  const mean = points.reduce((s, p) => s + p.value, 0) / points.length;
  const variance = points.reduce((s, p) => s + (p.value - mean) ** 2, 0) / (points.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return points.map((p) => ({ ...p, value: 0 }));
  return points.map((p) => ({ day: p.day, value: Math.round(((p.value - mean) / sd) * 1000) / 1000 }));
}

export interface Correlation {
  r: number;
  n: number;
  lagDays: number;
  strength: 'none' | 'weak' | 'moderate' | 'strong';
}

/**
 * Pearson correlation of `a` against `b` shifted by `lagDays`.
 * A positive lag asks: does *a* today track *b* from `lagDays` ago?
 */
export function correlate(a: Point[], b: Point[], lagDays = 0): Correlation {
  const bByDay = new Map(b.map((p) => [p.day, p.value]));
  const pairs: [number, number][] = [];

  for (const pa of a) {
    const shifted = shiftDay(pa.day, -lagDays);
    const vb = bByDay.get(shifted);
    if (vb == null) continue;
    pairs.push([pa.value, vb]);
  }

  const n = pairs.length;
  if (n < 3) return { r: 0, n, lagDays, strength: 'none' };

  const meanA = pairs.reduce((s, p) => s + p[0], 0) / n;
  const meanB = pairs.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (const [x, y] of pairs) {
    num += (x - meanA) * (y - meanB);
    da += (x - meanA) ** 2;
    db += (y - meanB) ** 2;
  }
  const denom = Math.sqrt(da * db);
  const r = denom === 0 ? 0 : num / denom;
  const abs = Math.abs(r);

  return {
    r: Math.round(r * 1000) / 1000,
    n,
    lagDays,
    strength: abs < 0.15 ? 'none' : abs < 0.3 ? 'weak' : abs < 0.5 ? 'moderate' : 'strong',
  };
}

/** Best-|r| lag within ±maxLag, useful for "does X show up N days later?". */
export function bestLag(a: Point[], b: Point[], maxLag = 7): Correlation {
  let best: Correlation = { r: 0, n: 0, lagDays: 0, strength: 'none' };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const c = correlate(a, b, lag);
    if (c.n >= 10 && Math.abs(c.r) > Math.abs(best.r)) best = c;
  }
  return best;
}

function shiftDay(day: DayKey, n: number): DayKey {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

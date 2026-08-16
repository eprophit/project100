import { all, one } from '../db';
import { addDays, today, type DayKey } from '../dates';
import { allMetrics, bestLag, correlate, getSeries, resolveMetric, smooth } from '../metrics';
import { formatAmount } from '../nutrition';
import {
  acwr,
  biomarkerDeltas,
  latestPanel,
  modalitySummaries,
  nutritionAdherence,
  nutritionDay,
  protocolTotals,
  recentWorkouts,
  supplementAdherence,
  todayCard,
} from '../queries';

/**
 * Tools the coach can call. Every one reads through the same query layer the UI
 * uses, so the model and the charts can never disagree about a number.
 *
 * Results are deliberately compact — summary statistics plus a downsampled
 * series — because handing a model 400 raw daily values wastes context and
 * makes it worse at arithmetic, not better.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'list_metrics',
    description:
      'List the metrics available for querying, with their units and domains. Call this first if you are unsure of a metric id.',
    input_schema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Optional filter: Training, Sleep, Recovery, Nutrition, Body, Protocols, Labs.',
        },
      },
    },
  },
  {
    name: 'query_metric',
    description:
      'Get a daily time series for one metric, with summary statistics and a comparison against the preceding window of equal length. Use this for "how is X trending" questions.',
    input_schema: {
      type: 'object',
      properties: {
        metric_id: { type: 'string', description: 'Metric id, e.g. recovery.hrv or row.pace.' },
        days: { type: 'integer', description: 'Window length in days, ending today. Default 30.' },
        to: { type: 'string', description: 'Optional end day, YYYY-MM-DD. Defaults to today.' },
        smooth: { type: 'integer', description: 'Rolling-mean window in days. Default 1 (no smoothing).' },
      },
      required: ['metric_id'],
    },
  },
  {
    name: 'correlate_metrics',
    description:
      'Correlate two metrics over a window, reporting same-day r and the strongest lagged relationship within ±7 days. A positive lag means metric A tracks metric B from N days earlier.',
    input_schema: {
      type: 'object',
      properties: {
        metric_a: { type: 'string' },
        metric_b: { type: 'string' },
        days: { type: 'integer', description: 'Window length in days. Default 120.' },
      },
      required: ['metric_a', 'metric_b'],
    },
  },
  {
    name: 'get_daily_summary',
    description:
      'Snapshot for one day: readiness, HRV vs baseline, resting HR, sleep, training load, acute:chronic ratio, intake and supplement adherence.',
    input_schema: {
      type: 'object',
      properties: { day: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' } },
    },
  },
  {
    name: 'get_training',
    description:
      'Training breakdown for a window: per-modality volume, load, trend and best efforts, plus the most recent sessions.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Window length in days. Default 30.' },
        modality: {
          type: 'string',
          description: 'Optional filter: rowing, cycling, running, strength, swimming, walking, mobility.',
        },
        limit: { type: 'integer', description: 'How many recent sessions to list. Default 10.' },
      },
    },
  },
  {
    name: 'get_nutrition',
    description:
      'Nutrition for a single day (meals and totals vs targets) or adherence statistics across a window.',
    input_schema: {
      type: 'object',
      properties: {
        day: { type: 'string', description: 'YYYY-MM-DD for a single-day breakdown.' },
        days: { type: 'integer', description: 'Window length for adherence stats. Default 14 when day is omitted.' },
      },
    },
  },
  {
    name: 'get_biomarkers',
    description:
      'Latest Function Health panel with reference and optimal ranges, plus the change from the first panel on record. Filter by category or a specific marker.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'e.g. Heart, Metabolic, Hormones, Inflammation.' },
        slug: { type: 'string', description: 'A specific marker, e.g. apob or hscrp, to get its full history.' },
      },
    },
  },
  {
    name: 'get_recovery_protocols',
    description:
      'Recovery protocol usage (sauna, cold exposure, breathwork, massage) and per-supplement adherence over a window.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'Window length in days. Default 30.' } },
    },
  },
];

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ToolOutcome {
  result: unknown;
  /** One-line human summary, shown in the chat transcript's tool trace. */
  summary: string;
}

export function runTool(name: string, input: Record<string, unknown>): ToolOutcome {
  switch (name) {
    case 'list_metrics':
      return listMetrics(input);
    case 'query_metric':
      return queryMetric(input);
    case 'correlate_metrics':
      return correlateMetrics(input);
    case 'get_daily_summary':
      return dailySummary(input);
    case 'get_training':
      return training(input);
    case 'get_nutrition':
      return nutrition(input);
    case 'get_biomarkers':
      return biomarkers(input);
    case 'get_recovery_protocols':
      return recovery(input);
    default:
      return { result: { error: `Unknown tool: ${name}` }, summary: `unknown tool ${name}` };
  }
}

function listMetrics(input: Record<string, unknown>): ToolOutcome {
  const domain = input.domain as string | undefined;
  const metrics = allMetrics()
    .filter((m) => !domain || m.domain.toLowerCase() === domain.toLowerCase())
    .map((m) => ({ id: m.id, label: m.label, unit: m.unit, domain: m.domain, better: m.better }));
  return { result: { metrics }, summary: `listed ${metrics.length} metrics${domain ? ` in ${domain}` : ''}` };
}

function windowFor(input: Record<string, unknown>, defaultDays: number): { from: DayKey; to: DayKey; days: number } {
  const days = Math.max(2, Math.min(400, Number(input.days) || defaultDays));
  const to = (input.to as string) ?? today();
  return { from: addDays(to, -(days - 1)), to, days };
}

function stats(points: { day: string; value: number }[]) {
  if (!points.length) return null;
  const values = points.map((p) => p.value);
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    n: values.length,
    mean: round(mean, 2),
    median: round(sorted[Math.floor(sorted.length / 2)], 2),
    min: round(sorted[0], 2),
    max: round(sorted[sorted.length - 1], 2),
    first: round(values[0], 2),
    last: round(values[values.length - 1], 2),
  };
}

/** Keeps series small enough to reason over without losing shape. */
function downsample(points: { day: string; value: number }[], max = 40) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: { day: string; value: number }[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  const last = points[points.length - 1];
  if (out[out.length - 1]?.day !== last.day) out.push(last);
  return out;
}

function queryMetric(input: Record<string, unknown>): ToolOutcome {
  const id = String(input.metric_id ?? '');
  const def = resolveMetric(id);
  if (!def) {
    return {
      result: { error: `Unknown metric "${id}". Call list_metrics for valid ids.` },
      summary: `unknown metric ${id}`,
    };
  }

  const { from, to, days } = windowFor(input, 30);
  const smoothWindow = Math.max(1, Number(input.smooth) || 1);

  const series = getSeries(id, from, to);
  const points = smooth(series.points, smoothWindow);

  // Same-length window immediately before, for an honest comparison.
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const prev = getSeries(id, prevFrom, prevTo);

  const current = stats(points);
  const previous = stats(prev.points);
  const changePct =
    current && previous && previous.mean !== 0
      ? round(((current.mean - previous.mean) / Math.abs(previous.mean)) * 100, 1)
      : null;

  return {
    result: {
      metric: { id: def.id, label: def.label, unit: def.unit, better: def.better, description: def.description },
      window: { from, to, days },
      stats: current,
      previous_window: { from: prevFrom, to: prevTo, stats: previous },
      change_pct_vs_previous: changePct,
      series: downsample(points),
    },
    summary: `${def.label} over ${days}d — mean ${current?.mean ?? '—'} ${def.unit}${
      changePct != null ? `, ${changePct > 0 ? '+' : ''}${changePct}% vs prior` : ''
    }`,
  };
}

function correlateMetrics(input: Record<string, unknown>): ToolOutcome {
  const a = String(input.metric_a ?? '');
  const b = String(input.metric_b ?? '');
  const { from, to, days } = windowFor(input, 120);

  if (!resolveMetric(a) || !resolveMetric(b)) {
    return {
      result: { error: 'One or both metric ids are unknown. Call list_metrics for valid ids.' },
      summary: 'bad metric ids',
    };
  }
  const sa = getSeries(a, from, to);
  const sb = getSeries(b, from, to);

  const sameDay = correlate(sa.points, sb.points, 0);
  const best = bestLag(sa.points, sb.points, 7);

  return {
    result: {
      window: { from, to, days },
      metric_a: { id: a, label: sa.label, unit: sa.unit },
      metric_b: { id: b, label: sb.label, unit: sb.unit },
      same_day: sameDay,
      best_lag: best,
      interpretation:
        best.lagDays === 0
          ? 'Strongest relationship is same-day.'
          : best.lagDays > 0
            ? `${sa.label} tracks ${sb.label} from ${best.lagDays} day(s) earlier.`
            : `${sa.label} leads ${sb.label} by ${Math.abs(best.lagDays)} day(s).`,
      caveat: 'Correlation over observational self-tracking data; confounded by training phase and season.',
    },
    summary: `${sa.label} vs ${sb.label}: r=${sameDay.r} same-day, best r=${best.r} at lag ${best.lagDays}d`,
  };
}

function dailySummary(input: Record<string, unknown>): ToolOutcome {
  const day = (input.day as string) ?? today();
  const card = todayCard(day);
  const ratio = acwr(day);
  const sessions = all<{ modality: string; title: string; duration_s: number; load: number }>(
    'SELECT modality, title, duration_s, load FROM workouts WHERE day = ? ORDER BY start_utc',
    [day],
  );

  return {
    result: {
      ...card,
      hrv_vs_baseline_pct:
        card.hrv && card.hrvBaseline ? round(((card.hrv - card.hrvBaseline) / card.hrvBaseline) * 100, 1) : null,
      acwr: ratio,
      sessions: sessions.map((s) => ({
        modality: s.modality,
        title: s.title,
        minutes: Math.round(s.duration_s / 60),
        load: s.load,
      })),
    },
    summary: `day ${day}: readiness ${card.readiness ?? '—'}, HRV ${card.hrv ?? '—'} ms, ACWR ${ratio.ratio ?? '—'}`,
  };
}

function training(input: Record<string, unknown>): ToolOutcome {
  const { from, to, days } = windowFor(input, 30);
  const modality = input.modality as string | undefined;
  const limit = Math.min(40, Number(input.limit) || 10);

  const summaries = modalitySummaries(from, to).filter((m) => !modality || m.modality === modality);
  const sessions = recentWorkouts(limit, from, to)
    .filter((w) => !modality || w.modality === modality)
    .map((w) => ({
      day: w.day,
      modality: w.modality,
      title: w.title,
      minutes: Math.round(w.duration_s / 60),
      km: w.distance_m ? round(w.distance_m / 1000, 2) : null,
      avg_hr: w.avg_hr,
      avg_watts: w.avg_watts,
      pace_s: w.pace_s,
      load: w.load,
    }));

  return {
    result: { window: { from, to, days }, by_modality: summaries, recent_sessions: sessions, acwr: acwr(to) },
    summary: `training ${days}d — ${summaries.reduce((s, m) => s + m.sessions, 0)} sessions across ${summaries.length} modalities`,
  };
}

function nutrition(input: Record<string, unknown>): ToolOutcome {
  if (input.day) {
    const d = nutritionDay(String(input.day));
    return {
      result: {
        day: d.day,
        totals: d.totals,
        targets: d.targets,
        // Grouped by meal, since "what did I have for lunch" is the question
        // this shape usually has to answer.
        meals: d.loggedMeals.map((m) => ({
          meal: m.slot,
          kcal: round(m.totals.kcal, 0),
          protein_g: round(m.totals.protein_g),
          items: m.entries.map((e) => ({
            food: e.food,
            amount: formatAmount(e.quantity, e.unit, e.serving_g),
            kcal: round(e.nutrients.kcal, 0),
            protein_g: round(e.nutrients.protein_g),
            carbs_g: round(e.nutrients.carbs_g),
            fat_g: round(e.nutrients.fat_g),
          })),
        })),
        planned_totals: d.plannedTotals,
      },
      summary: `nutrition ${d.day}: ${round(d.totals.kcal, 0)} kcal / ${round(d.totals.protein_g)} g protein`,
    };
  }

  const { from, to, days } = windowFor(input, 14);
  const adherence = nutritionAdherence(from, to);
  return {
    result: { window: { from, to, days }, ...adherence },
    summary: `nutrition ${days}d — avg ${adherence.avgKcal} kcal, ${adherence.avgProtein} g protein, protein target hit ${adherence.proteinHitRate}% of days`,
  };
}

function biomarkers(input: Record<string, unknown>): ToolOutcome {
  const slug = input.slug as string | undefined;

  if (slug) {
    const history = all<{ day: string; value: number; unit: string; status: string; name: string }>(
      'SELECT day, value, unit, status, name FROM biomarkers WHERE slug = ? ORDER BY day',
      [slug],
    );
    if (!history.length) {
      return { result: { error: `No biomarker with slug "${slug}".` }, summary: `no marker ${slug}` };
    }
    const ranges = one<{ ref_low: number; ref_high: number; optimal_low: number; optimal_high: number }>(
      'SELECT ref_low, ref_high, optimal_low, optimal_high FROM biomarkers WHERE slug = ? ORDER BY day DESC LIMIT 1',
      [slug],
    );
    return {
      result: { slug, name: history[0].name, unit: history[0].unit, ranges, history },
      summary: `${history[0].name} history: ${history.map((h) => h.value).join(' → ')}`,
    };
  }

  const panel = latestPanel();
  const category = input.category as string | undefined;
  const markers = panel.markers
    .filter((m) => !category || m.category.toLowerCase() === category.toLowerCase())
    .map((m) => ({
      name: m.name,
      slug: m.slug,
      category: m.category,
      value: m.value,
      unit: m.unit,
      reference: [m.ref_low, m.ref_high],
      optimal: [m.optimal_low, m.optimal_high],
      status: m.status,
    }));

  const deltas = biomarkerDeltas()
    .filter((d) => !category || d.category.toLowerCase() === category.toLowerCase())
    .map((d) => ({
      name: d.name,
      slug: d.slug,
      first: d.first_v,
      latest: d.last_v,
      change_pct: d.first_v ? round(((d.last_v - d.first_v) / Math.abs(d.first_v)) * 100, 1) : null,
      status: d.status,
    }));

  return {
    result: { panel_day: panel.day, markers, change_since_first_panel: deltas },
    summary: `panel ${panel.day}: ${markers.length} markers, ${markers.filter((m) => m.status === 'out_of_range').length} out of range`,
  };
}

function recovery(input: Record<string, unknown>): ToolOutcome {
  const { from, to, days } = windowFor(input, 30);
  const protocols = protocolTotals(from, to);
  const supplements = supplementAdherence(from, to);
  return {
    result: { window: { from, to, days }, protocols, supplement_adherence: supplements },
    summary: `${days}d — ${protocols.reduce((s, p) => s + p.sessions, 0)} protocol sessions, worst supplement adherence ${supplements[0]?.pct ?? '—'}%`,
  };
}

function round(v: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

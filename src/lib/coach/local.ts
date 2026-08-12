import { today } from '../dates';
import { runTool } from './tools';

/**
 * Offline fallback for the coach.
 *
 * When ANTHROPIC_API_KEY is absent the chat still works, it just stops being a
 * conversation: intent is matched by keyword and the answer is composed from the
 * same tools the model would have called. It is explicitly labelled as the
 * fallback in the UI — the point is that the feature degrades to something
 * truthful rather than to an error page.
 */

interface Route {
  test: RegExp;
  tools: { name: string; input: Record<string, unknown> }[];
  render: (results: Record<string, any>) => string;
}

const ROUTES: Route[] = [
  {
    test: /\b(today|now|readiness|ready|should i train|how am i)\b/i,
    tools: [{ name: 'get_daily_summary', input: {} }],
    render: (r) => {
      const d = r.get_daily_summary;
      const lines: string[] = [];
      lines.push(`**Today — ${d.day}**`);
      if (d.readiness != null) lines.push(`Readiness ${d.readiness}/100.`);
      if (d.hrv != null && d.hrvBaseline != null) {
        const pct = d.hrv_vs_baseline_pct;
        lines.push(
          `HRV ${d.hrv} ms against a 60-day baseline of ${d.hrvBaseline} ms (${pct > 0 ? '+' : ''}${pct}%).`,
        );
      }
      if (d.restingHr != null) lines.push(`Resting HR ${d.restingHr} bpm.`);
      if (d.sleepHours != null) lines.push(`Slept ${d.sleepHours} h.`);
      if (d.acwr?.ratio != null) lines.push(`Acute:chronic load ${d.acwr.ratio} — ${d.acwr.verdict.toLowerCase()}.`);
      if (d.sessions?.length) {
        lines.push(
          `\nLogged today: ${d.sessions.map((s: any) => `${s.modality} ${s.minutes} min`).join(', ')}.`,
        );
      } else {
        lines.push('\nNothing logged today yet.');
      }
      if (d.supplementsDue) lines.push(`Supplements: ${d.supplementsTaken}/${d.supplementsDue} taken.`);
      return lines.join('\n');
    },
  },
  {
    test: /\b(sleep|slept|bed)\b/i,
    tools: [
      { name: 'query_metric', input: { metric_id: 'sleep.duration', days: 30 } },
      { name: 'correlate_metrics', input: { metric_a: 'recovery.hrv', metric_b: 'sleep.duration', days: 120 } },
    ],
    render: (r) => {
      const q = r.query_metric;
      const c = r.correlate_metrics;
      return [
        `**Sleep over the last 30 days**`,
        `Mean ${q.stats?.mean} h, from ${q.stats?.min} h to ${q.stats?.max} h.`,
        q.change_pct_vs_previous != null
          ? `${q.change_pct_vs_previous > 0 ? 'Up' : 'Down'} ${Math.abs(q.change_pct_vs_previous)}% on the previous 30 days.`
          : '',
        '',
        `Sleep duration vs HRV: best r = ${c.best_lag.r} at lag ${c.best_lag.lagDays} d (n = ${c.best_lag.n}).`,
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    test: /\b(hrv|heart rate variability|recovery trend)\b/i,
    tools: [
      { name: 'query_metric', input: { metric_id: 'recovery.hrv', days: 30 } },
      { name: 'correlate_metrics', input: { metric_a: 'recovery.hrv', metric_b: 'training.acute', days: 120 } },
    ],
    render: (r) => {
      const q = r.query_metric;
      const c = r.correlate_metrics;
      return [
        `**HRV over the last 30 days**`,
        `Mean ${q.stats?.mean} ms (range ${q.stats?.min}–${q.stats?.max}).`,
        q.change_pct_vs_previous != null
          ? `That is ${q.change_pct_vs_previous > 0 ? 'up' : 'down'} ${Math.abs(q.change_pct_vs_previous)}% on the previous 30 days.`
          : '',
        '',
        `Against 7-day acute training load, same-day r = ${c.same_day.r} (${c.same_day.strength}); the strongest relationship is r = ${c.best_lag.r} at a lag of ${c.best_lag.lagDays} days. ${c.interpretation}`,
        '',
        `_${c.caveat}_`,
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    test: /\b(nutrition|eat|eating|protein|calorie|kcal|macro|diet)\b/i,
    tools: [
      { name: 'get_nutrition', input: { days: 14 } },
      { name: 'get_nutrition', input: { day: today() } },
    ],
    render: (r) => {
      const a = r.get_nutrition_0;
      const d = r.get_nutrition_1;
      return [
        `**Intake, last 14 days**`,
        `Average ${a.avgKcal} kcal · ${a.avgProtein} g protein · ${a.avgCarbs} g carbs · ${a.avgFat} g fat · ${a.avgFiber} g fibre.`,
        `Protein target met on ${a.proteinHitRate}% of days; calories within 10% of target on ${a.kcalHitRate}%.`,
        '',
        `**Today (${d.day})**`,
        `${d.totals.kcal} / ${d.targets.kcal} kcal · ${d.totals.protein_g} / ${d.targets.protein_g} g protein · ${d.totals.fiber_g} / ${d.targets.fiber_g} g fibre.`,
        d.entries?.length ? `\nLogged: ${d.entries.map((e: any) => e.food).join(', ')}.` : '\nNothing logged yet today.',
      ].join('\n');
    },
  },
  {
    test: /\b(blood|biomarker|lab|panel|apob|cholesterol|crp|testosterone|ferritin|vitamin)\b/i,
    tools: [{ name: 'get_biomarkers', input: {} }],
    render: (r) => {
      const b = r.get_biomarkers;
      const out = b.markers.filter((m: any) => m.status === 'out_of_range');
      const improved = (b.change_since_first_panel ?? [])
        .filter((d: any) => d.change_pct != null)
        .sort((x: any, y: any) => Math.abs(y.change_pct) - Math.abs(x.change_pct))
        .slice(0, 6);
      return [
        `**Latest panel — ${b.panel_day}**`,
        `${b.markers.length} markers. ${out.length ? `Out of reference range: ${out.map((m: any) => `${m.name} ${m.value} ${m.unit}`).join(', ')}.` : 'Everything inside the reference range.'}`,
        '',
        `**Biggest movers since the first panel**`,
        ...improved.map((d: any) => `- ${d.name}: ${d.first} → ${d.latest} (${d.change_pct > 0 ? '+' : ''}${d.change_pct}%) · ${d.status.replace(/_/g, ' ')}`),
        '',
        `_Lab values are for tracking, not diagnosis. Discuss anything out of range with your clinician._`,
      ].join('\n');
    },
  },
  {
    test: /\b(supplement|stack|sauna|cold|plunge|protocol|breathwork)\b/i,
    tools: [{ name: 'get_recovery_protocols', input: { days: 30 } }],
    render: (r) => {
      const p = r.get_recovery_protocols;
      return [
        `**Recovery protocols, last 30 days**`,
        ...p.protocols.map((x: any) => `- ${x.kind.replace(/_/g, ' ')}: ${x.sessions} sessions, ${Math.round(x.minutes)} min total`),
        '',
        `**Supplement adherence**`,
        ...p.supplement_adherence.slice(0, 12).map((s: any) => `- ${s.name}: ${s.pct}% (${s.taken}/${s.due})`),
      ].join('\n');
    },
  },
  {
    test: /\b(training|workout|row|erg|bike|cycling|run|lift|strength|volume|load)\b/i,
    tools: [{ name: 'get_training', input: { days: 30, limit: 8 } }],
    render: (r) => {
      const t = r.get_training;
      return [
        `**Training, last 30 days**`,
        ...t.by_modality.map(
          (m: any) =>
            `- ${m.modality}: ${m.sessions} sessions, ${m.minutes} min, load ${m.load}${
              m.best ? ` · ${m.best.label} ${m.best.value}` : ''
            }${m.trendPct != null ? ` · ${m.trendPct > 0 ? '+' : ''}${m.trendPct}% load vs first half` : ''}`,
        ),
        '',
        `Acute:chronic ${t.acwr.ratio ?? '—'} — ${t.acwr.verdict.toLowerCase()}.`,
        '',
        `**Recent sessions**`,
        ...t.recent_sessions
          .slice(0, 8)
          .map((s: any) => `- ${s.day} ${s.modality} ${s.minutes} min${s.km ? ` · ${s.km} km` : ''}${s.avg_watts ? ` · ${s.avg_watts} W` : ''}`),
      ].join('\n');
    },
  },
];

const FALLBACK = `I can answer from your data without an API key, but only along a few fixed paths. Try asking about **today's readiness**, **HRV**, **sleep**, **nutrition**, **training**, **biomarkers**, or **supplements and protocols**.

Set \`ANTHROPIC_API_KEY\` in \`.env.local\` to enable the full coach, which can call any of the eight data tools, combine them, and answer follow-ups.`;

export function localCoach(question: string): { text: string; trace: { tool: string; summary: string }[] } {
  const route = ROUTES.find((r) => r.test.test(question));
  if (!route) return { text: FALLBACK, trace: [] };

  const results: Record<string, unknown> = {};
  const trace: { tool: string; summary: string }[] = [];
  const counts = new Map<string, number>();

  for (const call of route.tools) {
    const outcome = runTool(call.name, call.input);
    const n = counts.get(call.name) ?? 0;
    counts.set(call.name, n + 1);
    // First call lands on the bare name; repeats also get an indexed key so a
    // route can use several calls to the same tool.
    if (n === 0) results[call.name] = outcome.result;
    results[`${call.name}_${n}`] = outcome.result;
    trace.push({ tool: call.name, summary: outcome.summary });
  }

  return { text: route.render(results as Record<string, any>), trace };
}

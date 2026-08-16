/**
 * Pipeline smoke test. Runs the real bootstrap (schema → seed → full backfill),
 * then re-runs a sync to prove the second pass is idempotent.
 *
 *   node --experimental-strip-types scripts/check.ts
 */
import { ensureReady } from '../src/lib/bootstrap.ts';
import { all, one } from '../src/lib/db.ts';
import { addDays, today } from '../src/lib/dates.ts';
import { bestLag, getSeries } from '../src/lib/metrics.ts';
import {
  applyWeekTemplate,
  clearLocalEntries,
  entriesForDay,
  listDayTemplates,
  listMealTemplates,
  listWeekTemplates,
} from '../src/lib/mealPlans.ts';
import { FACTOR_SQL, ZERO_NUTRIENTS, resolveNutrients, round } from '../src/lib/nutrition.ts';
import { acwr, coverage, modalitySummaries, todayCard } from '../src/lib/queries.ts';
import { syncAll } from '../src/lib/sync/engine.ts';

const t0 = Date.now();
await ensureReady();
console.log(`bootstrap: ${Date.now() - t0} ms\n`);

console.log('--- coverage -------------------------------------------------');
for (const [domain, row] of Object.entries(coverage())) {
  console.log(`  ${domain.padEnd(11)} ${String(row?.n ?? 0).padStart(6)} rows  ${row?.first ?? '—'} → ${row?.last ?? '—'}`);
}

console.log('\n--- idempotency (second sync should insert 0) -----------------');
const second = await syncAll();
for (const r of second) {
  console.log(
    `  ${r.sourceId.padEnd(16)} ${r.status.padEnd(8)} pages=${r.pages} fetched=${String(r.fetched).padStart(5)} ` +
      `ins=${r.inserted} upd=${r.updated} retries=${r.retries} ${r.durationMs}ms${r.error ? ` err=${r.error}` : ''}`,
  );
}

console.log('\n--- 90-day modality breakdown --------------------------------');
for (const m of modalitySummaries(addDays(today(), -89), today())) {
  console.log(
    `  ${m.modality.padEnd(10)} ${String(m.sessions).padStart(3)} sessions  ${String(m.minutes).padStart(5)} min  ` +
      `load ${String(m.load).padStart(5)}  ${m.best ? `${m.best.label}: ${m.best.value}` : ''}`,
  );
}

console.log('\n--- today ----------------------------------------------------');
console.log(' ', JSON.stringify(todayCard()));
console.log('  ACWR:', JSON.stringify(acwr()));

console.log('\n--- correlations (does yesterday show up in today?) -----------');
const from = addDays(today(), -180);
const to = today();
const pairs: [string, string][] = [
  ['recovery.hrv', 'training.acute'],
  ['recovery.hrv', 'training.load'],
  ['recovery.hrv', 'sleep.duration'],
  ['recovery.rhr', 'training.acute'],
  ['recovery.readiness', 'training.acute'],
  ['row.watts', 'recovery.readiness'],
  ['nutrition.kcal', 'training.load'],
];
for (const [a, b] of pairs) {
  const sa = getSeries(a, from, to);
  const sb = getSeries(b, from, to);
  if (!sa || !sb) { console.log(`  ${a} vs ${b}: missing series`); continue; }
  const c = bestLag(sa.points, sb.points, 5);
  console.log(`  ${a.padEnd(18)} vs ${b.padEnd(18)} r=${String(c.r).padStart(6)} lag=${String(c.lagDays).padStart(2)}d n=${c.n} (${c.strength})`);
}

console.log('\n--- labs -----------------------------------------------------');
const panels = all<{ day: string; n: number }>('SELECT day, COUNT(*) n FROM biomarkers GROUP BY day ORDER BY day');
for (const p of panels) console.log(`  ${p.day}: ${p.n} markers`);
const apob = all<{ day: string; value: number; status: string }>(
  "SELECT day, value, status FROM biomarkers WHERE slug='apob' ORDER BY day",
);
console.log('  ApoB:', apob.map((r) => `${r.day}=${r.value} (${r.status})`).join('  '));

console.log('\n--- continuity (silent holes a row count would miss) --------');
const trainingDays = all<{ day: string }>('SELECT DISTINCT day FROM workouts ORDER BY day').map((r) => r.day);
let prevDay: string | null = null;
const holes: string[] = [];
for (const d of trainingDays) {
  if (prevDay) {
    const gap = (new Date(d).getTime() - new Date(prevDay).getTime()) / 86_400_000;
    if (gap > 3) holes.push(`${prevDay} → ${d} (${gap - 1} days without a session)`);
  }
  prevDay = d;
}
console.log(holes.length ? holes.map((h) => `  ${h}`).join('\n') : '  no training gap longer than 3 days');

console.log('\n--- nutrition plan layer -------------------------------------');
console.log(
  `  library: ${listMealTemplates().length} meals, ${listDayTemplates().length} days, ${listWeekTemplates().length} weeks`,
);

// The SQL multiplier and its TypeScript twin must agree, or a day's totals in
// the charts would disagree with the same day's totals in the meal list.
const sqlTotals = all<{ id: string; kcal: number; protein: number }>(
  `SELECT id, n_kcal * ${FACTOR_SQL} AS kcal, n_protein_g * ${FACTOR_SQL} AS protein
   FROM nutrition_entries ORDER BY id LIMIT 500`,
);
const byId = new Map(sqlTotals.map((r) => [r.id, r]));
const sampleDays = all<{ day: string }>(
  'SELECT DISTINCT day FROM nutrition_entries ORDER BY day LIMIT 40',
).map((r) => r.day);
let compared = 0;
let drift = 0;
for (const d of sampleDays) {
  for (const e of entriesForDay(d, false)) {
    const sql = byId.get(e.id);
    if (!sql) continue;
    compared += 1;
    if (Math.abs(sql.kcal - e.nutrients.kcal) > 0.01 || Math.abs(sql.protein - e.nutrients.protein_g) > 0.01) {
      drift += 1;
      if (drift <= 3) console.log(`  DRIFT ${e.id}: sql ${round(sql.kcal, 3)} vs ts ${e.nutrients.kcal} kcal`);
    }
  }
}
console.log(`  SQL vs TypeScript nutrient resolution: ${compared} entries compared, ${drift} disagreements`);

// Unit conversion has to be lossless in both directions, or editing an amount
// twice would quietly change what was eaten.
const chickenPer100g = { ...ZERO_NUTRIENTS, kcal: 165, protein_g: 31 };
const roundTrip = resolveNutrients({ quantity: 150, unit: 'g', basis: 'per_100g', serving_g: 150, base: chickenPer100g });
const asOunces = resolveNutrients({
  quantity: 150 / 28.349523125,
  unit: 'oz',
  basis: 'per_100g',
  serving_g: 150,
  base: chickenPer100g,
});
const asServings = resolveNutrients({ quantity: 1, unit: 'serving', basis: 'per_100g', serving_g: 150, base: chickenPer100g });
const unitsAgree =
  Math.abs(roundTrip.kcal - asServings.kcal) < 0.01 && Math.abs(roundTrip.kcal - asOunces.kcal) < 0.01;
console.log(
  `  150 g / 5.29 oz / 1 serving of the same food: ${roundTrip.kcal} · ${round(asOunces.kcal, 2)} · ` +
    `${asServings.kcal} kcal (${unitsAgree ? 'agree' : 'DISAGREE'})`,
);

// Rolling a week template out and clearing it again must leave imported rows
// untouched — that is the whole contract of `clearLocalEntries`.
const week = listWeekTemplates()[0];
if (week) {
  const start = addDays(today(), 7);
  const applied = applyWeekTemplate({ templateId: week.id, startDay: start, planned: true, replace: true });
  const landed = entriesForDay(start, true).length;
  let removed = 0;
  for (let i = 0; i < 7; i++) removed += clearLocalEntries(addDays(start, i), true);
  console.log(
    `  "${week.name}" → ${applied.days} days / ${applied.entries} entries (${landed} on day 1), ${removed} cleared`,
  );
}

const dupes = one<{ n: number }>(
  'SELECT COUNT(*) n FROM (SELECT source_id, external_id FROM workouts GROUP BY source_id, external_id HAVING COUNT(*) > 1)',
);
console.log(`\nduplicate workout keys: ${dupes?.n ?? 0}`);
console.log(`total: ${Date.now() - t0} ms`);

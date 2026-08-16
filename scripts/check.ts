/**
 * Pipeline smoke test. Runs the real bootstrap (schema → seed → full backfill),
 * then re-runs a sync to prove the second pass is idempotent.
 *
 *   node --experimental-strip-types scripts/check.ts
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureReady } from '../src/lib/bootstrap.ts';
import { simDayMap } from '../src/lib/sim/athlete.ts';
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
import { detectSource, importStagedFile } from '../src/lib/imports/importer.ts';
import { describeFile } from '../src/lib/imports/store.ts';
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

// Sleep segments are attributed to the night you wake up on. Keying them by
// the segment's end instead splits a night across two days, which stays
// invisible in row counts and shows up only as a weakened HRV correlation.
console.log('\n--- sleep attribution ----------------------------------------');
{
  const sim = simDayMap();
  const nights = all<{ day: string; total_min: number; awake_min: number }>(
    "SELECT day, total_min, awake_min FROM sleep WHERE source_id = 'apple_health'",
  );
  let matched = 0;
  let worst = 0;
  for (const n of nights) {
    const s = sim.get(n.day);
    if (!s) continue;
    // The simulator's totalMin is time in bed; the connector stores asleep.
    const drift = Math.max(
      Math.abs(n.total_min - (s.sleep.totalMin - s.sleep.awakeMin)),
      Math.abs(n.awake_min - s.sleep.awakeMin),
    );
    if (drift <= 1) matched += 1;
    else worst = Math.max(worst, drift);
  }
  const split = one<{ n: number }>(
    "SELECT COUNT(*) n FROM (SELECT day FROM sleep WHERE source_id = 'apple_health' GROUP BY day HAVING COUNT(*) > 1)",
  );
  console.log(`  ${matched}/${nights.length} nights fold back to the simulator's values${worst ? ` (worst drift ${worst.toFixed(1)} min)` : ''}`);
  console.log(`  days carrying more than one night row: ${split?.n ?? 0}`);
}

console.log('\n--- file imports ---------------------------------------------');
await checkImports();

const dupes = one<{ n: number }>(
  'SELECT COUNT(*) n FROM (SELECT source_id, external_id FROM workouts GROUP BY source_id, external_id HAVING COUNT(*) > 1)',
);
console.log(`\nduplicate workout keys: ${dupes?.n ?? 0}`);
console.log(`total: ${Date.now() - t0} ms`);

/**
 * Exercises the import path on synthetic exports shaped like the real ones.
 *
 * The assertion that matters is the second import: a file with the same content
 * but different bytes must *update* every row rather than insert a duplicate.
 * That is the property the whole feature rests on — you can re-export an
 * overlapping range without first working out what you already have.
 */
async function checkImports(): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitalis-import-'));
  try {
    const day = (n: number) => addDays(today(), -n);

    const hrv = [
      'date,rMSSD,lnrMSSD,HR,recovery_points,tags,note',
      ...Array.from({ length: 10 }, (_, i) =>
        `${day(i + 1)},${(58 + i).toFixed(1)},${Math.log(58 + i).toFixed(2)},${48 + (i % 5)},${60 + i},sauna,ok`),
    ].join('\n');

    const labs = [
      'Collected On,Category,Biomarker,Result,Unit,Reference Range,Optimal Range',
      `${day(30)},Heart,ApoB,81,mg/dL,"0 - 90","0 - 80"`,
      `${day(30)},Inflammation,hs-CRP,0.6,mg/L,"< 3.0","< 1.0"`,
    ].join('\n');

    const diary = [
      'Date,Meal,Food,Calories,Fat (g),Carbohydrates (g),Protein (g),Sodium (mg)',
      `${day(1)},Breakfast,"Oats, rolled",380,6.5,67,13,6`,
      `${day(1)},Lunch,"Chicken bowl, ""large""",742,14.2,88,55,420`,
    ].join('\n');

    const files: [string, string][] = [
      ['hrv4training-export.csv', hrv],
      ['function-health-results.csv', labs],
      ['mfp-nutrition.csv', diary],
    ];

    for (const [name, body] of files) {
      const full = path.join(dir, name);
      await fsp.writeFile(full, body);
      const file = await describeFile(full);
      const detected = detectSource(file);
      const first = await importStagedFile(file);

      // Same content, different bytes: a trailing newline is enough to make the
      // hash differ, so the duplicate short-circuit cannot be what saves us.
      const copy = path.join(dir, `copy-${name}`);
      await fsp.writeFile(copy, `${body}\n`);
      const second = await importStagedFile(await describeFile(copy));

      const clean = second.inserted === 0 && second.updated === first.records;
      console.log(
        `  ${name.padEnd(30)} → ${(detected?.id ?? 'UNDETECTED').padEnd(16)} ` +
          `${String(first.records).padStart(3)} rows, ins ${first.inserted}/upd ${first.updated}; ` +
          `re-import ins ${second.inserted}/upd ${second.updated} ${clean ? '(idempotent)' : '(DUPLICATED)'}`,
      );
    }

    const failed = one<{ n: number }>("SELECT COUNT(*) n FROM imports WHERE status = 'error'");
    console.log(`  imports recorded with an error: ${failed?.n ?? 0}`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

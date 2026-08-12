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

const dupes = one<{ n: number }>(
  'SELECT COUNT(*) n FROM (SELECT source_id, external_id FROM workouts GROUP BY source_id, external_id HAVING COUNT(*) > 1)',
);
console.log(`\nduplicate workout keys: ${dupes?.n ?? 0}`);
console.log(`total: ${Date.now() - t0} ms`);

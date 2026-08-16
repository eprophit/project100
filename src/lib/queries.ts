import { all, getJsonSetting, one } from './db';
import { addDays, today, type DayKey } from './dates';
import { entriesForDay, groupIntoMeals } from './mealPlans';
import { getSeries } from './metrics';
import { FACTOR_SQL, sumNutrients } from './nutrition';
import { DEFAULT_TARGETS, type Biomarker, type MacroTargets, type Supplement, type SyncRunRow, type Workout } from './types';

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface TodayCard {
  day: DayKey;
  readiness: number | null;
  hrv: number | null;
  hrvBaseline: number | null;
  restingHr: number | null;
  sleepHours: number | null;
  acuteLoad: number | null;
  chronicLoad: number | null;
  kcal: number | null;
  protein: number | null;
  weight: number | null;
  supplementsTaken: number;
  supplementsDue: number;
  protocolMinutes: number;
}

export function todayCard(day: DayKey = today()): TodayCard {
  const rec = one<{ readiness: number; hrv_rmssd: number; resting_hr: number }>(
    'SELECT readiness, hrv_rmssd, resting_hr FROM recovery WHERE day = ?',
    [day],
  );
  const baseline = one<{ v: number }>(
    'SELECT AVG(hrv_rmssd) AS v FROM recovery WHERE day BETWEEN ? AND ?',
    [addDays(day, -60), addDays(day, -1)],
  );
  const sleep = one<{ v: number }>('SELECT total_min AS v FROM sleep WHERE day = ?', [day]);
  const nut = one<{ kcal: number; protein: number }>(
    `SELECT SUM(n_kcal * ${FACTOR_SQL}) AS kcal, SUM(n_protein_g * ${FACTOR_SQL}) AS protein
     FROM nutrition_entries WHERE day = ? AND planned = 0`,
    [day],
  );
  const body = one<{ v: number }>('SELECT weight_kg AS v FROM body_metrics WHERE day = ?', [day]);
  const supp = one<{ taken: number; due: number }>(
    'SELECT SUM(taken) AS taken, COUNT(*) AS due FROM supplement_logs WHERE day = ?',
    [day],
  );
  const proto = one<{ v: number }>('SELECT SUM(minutes) AS v FROM protocols WHERE day = ?', [day]);

  const acute = getSeries('training.acute', addDays(day, -3), day).points.at(-1)?.value ?? null;
  const chronic = getSeries('training.chronic', addDays(day, -3), day).points.at(-1)?.value ?? null;

  return {
    day,
    readiness: rec?.readiness ?? null,
    hrv: rec?.hrv_rmssd ?? null,
    hrvBaseline: baseline?.v != null ? Math.round(baseline.v * 10) / 10 : null,
    restingHr: rec?.resting_hr ?? null,
    sleepHours: sleep?.v != null ? Math.round((sleep.v / 60) * 100) / 100 : null,
    acuteLoad: acute,
    chronicLoad: chronic,
    kcal: nut?.kcal ?? null,
    protein: nut?.protein ?? null,
    weight: body?.v ?? null,
    supplementsTaken: supp?.taken ?? 0,
    supplementsDue: supp?.due ?? 0,
    protocolMinutes: proto?.v ?? 0,
  };
}

/** Acute:chronic workload ratio — the classic overreaching flag. */
export function acwr(day: DayKey = today()): { ratio: number | null; verdict: string } {
  const card = todayCard(day);
  if (!card.acuteLoad || !card.chronicLoad) return { ratio: null, verdict: 'Not enough history' };
  const ratio = Math.round((card.acuteLoad / card.chronicLoad) * 100) / 100;
  const verdict =
    ratio > 1.5
      ? 'Spike — high injury risk'
      : ratio > 1.3
        ? 'Ramping fast'
        : ratio >= 0.8
          ? 'Productive range'
          : 'Detraining / taper';
  return { ratio, verdict };
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export interface ModalitySummary {
  modality: string;
  sessions: number;
  minutes: number;
  distanceKm: number;
  load: number;
  avgHr: number | null;
  best: { label: string; value: string } | null;
  trendPct: number | null;
}

export function modalitySummaries(from: DayKey, to: DayKey): ModalitySummary[] {
  const rows = all<{
    modality: string;
    sessions: number;
    seconds: number;
    distance: number | null;
    load: number;
    avg_hr: number | null;
  }>(
    `SELECT modality, COUNT(*) AS sessions, SUM(duration_s) AS seconds,
            SUM(distance_m) AS distance, SUM(load) AS load, AVG(avg_hr) AS avg_hr
     FROM workouts WHERE day BETWEEN ? AND ? GROUP BY modality ORDER BY load DESC`,
    [from, to],
  );

  const halfway = addDays(from, Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 / 2));

  return rows.map((r) => {
    const first = one<{ v: number }>(
      'SELECT SUM(load) AS v FROM workouts WHERE modality = ? AND day BETWEEN ? AND ?',
      [r.modality, from, halfway],
    );
    const second = one<{ v: number }>(
      'SELECT SUM(load) AS v FROM workouts WHERE modality = ? AND day BETWEEN ? AND ?',
      [r.modality, addDays(halfway, 1), to],
    );
    const trendPct =
      first?.v && second?.v ? Math.round(((second.v - first.v) / first.v) * 1000) / 10 : null;

    return {
      modality: r.modality,
      sessions: r.sessions,
      minutes: Math.round(r.seconds / 60),
      distanceKm: Math.round(((r.distance ?? 0) / 1000) * 10) / 10,
      load: Math.round(r.load),
      avgHr: r.avg_hr != null ? Math.round(r.avg_hr) : null,
      best: bestEffort(r.modality, from, to),
      trendPct,
    };
  });
}

function bestEffort(modality: string, from: DayKey, to: DayKey): { label: string; value: string } | null {
  if (modality === 'rowing') {
    const r = one<{ v: number; day: string }>(
      `SELECT MIN(pace_s) AS v, day FROM workouts
       WHERE modality='rowing' AND pace_s IS NOT NULL AND day BETWEEN ? AND ?`,
      [from, to],
    );
    if (!r?.v) return null;
    const m = Math.floor(r.v / 60);
    const s = (r.v % 60).toFixed(1).padStart(4, '0');
    return { label: 'Best avg split', value: `${m}:${s} /500m` };
  }
  if (modality === 'cycling') {
    const r = one<{ v: number }>(
      `SELECT MAX(avg_watts) AS v FROM workouts WHERE modality='cycling' AND day BETWEEN ? AND ?`,
      [from, to],
    );
    return r?.v ? { label: 'Best avg power', value: `${Math.round(r.v)} W` } : null;
  }
  if (modality === 'running') {
    const r = one<{ v: number }>(
      `SELECT MIN(pace_s) AS v FROM workouts WHERE modality='running' AND pace_s IS NOT NULL AND day BETWEEN ? AND ?`,
      [from, to],
    );
    if (!r?.v) return null;
    return { label: 'Best avg pace', value: `${Math.floor(r.v / 60)}:${String(Math.round(r.v % 60)).padStart(2, '0')} /km` };
  }
  if (modality === 'strength') {
    const r = one<{ v: number }>(
      `SELECT MAX(vol) AS v FROM (
         SELECT SUM(s.reps * s.weight_kg) AS vol FROM strength_sets s
         JOIN workouts w ON w.id = s.workout_id
         WHERE w.day BETWEEN ? AND ? GROUP BY w.id)`,
      [from, to],
    );
    return r?.v ? { label: 'Biggest session', value: `${Math.round(r.v).toLocaleString()} kg` } : null;
  }
  const r = one<{ v: number }>(
    'SELECT MAX(duration_s) AS v FROM workouts WHERE modality = ? AND day BETWEEN ? AND ?',
    [modality, from, to],
  );
  return r?.v ? { label: 'Longest', value: `${Math.round(r.v / 60)} min` } : null;
}

export function recentWorkouts(limit = 25, from?: DayKey, to?: DayKey): Workout[] {
  if (from && to) {
    return all<Workout>(
      'SELECT * FROM workouts WHERE day BETWEEN ? AND ? ORDER BY start_utc DESC LIMIT ?',
      [from, to, limit],
    );
  }
  return all<Workout>('SELECT * FROM workouts ORDER BY start_utc DESC LIMIT ?', [limit]);
}

export function workoutDetail(id: string) {
  const workout = one<Workout>('SELECT * FROM workouts WHERE id = ?', [id]);
  if (!workout) return null;
  return {
    workout,
    intervals: all('SELECT * FROM workout_intervals WHERE workout_id = ? ORDER BY idx', [id]),
    sets: all('SELECT * FROM strength_sets WHERE workout_id = ? ORDER BY exercise, set_no', [id]),
  };
}

/** Estimated 1RM progression per lift (Epley). */
export function liftProgress(from: DayKey, to: DayKey) {
  return all<{ exercise: string; day: string; e1rm: number; top_weight: number }>(
    `SELECT s.exercise, w.day,
            MAX(s.weight_kg * (1 + s.reps / 30.0)) AS e1rm,
            MAX(s.weight_kg) AS top_weight
     FROM strength_sets s JOIN workouts w ON w.id = s.workout_id
     WHERE w.day BETWEEN ? AND ?
     GROUP BY s.exercise, w.day ORDER BY s.exercise, w.day`,
    [from, to],
  );
}

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export function getTargets(): MacroTargets {
  return getJsonSetting<MacroTargets>('targets', DEFAULT_TARGETS);
}

/**
 * A day's food log and plan, grouped into meals with per-meal totals.
 *
 * The nutrient arithmetic lives in `mealPlans`, which resolves each entry's
 * stored basis and quantity into actual nutrients. This function is only the
 * page-level assembly: log, plan, totals, targets.
 */
export function nutritionDay(day: DayKey) {
  const logged = entriesForDay(day, false);
  const planned = entriesForDay(day, true);
  return {
    day,
    logged,
    planned,
    loggedMeals: groupIntoMeals(logged),
    plannedMeals: groupIntoMeals(planned),
    totals: sumNutrients(logged.map((e) => e.nutrients)),
    plannedTotals: sumNutrients(planned.map((e) => e.nutrients)),
    targets: getTargets(),
  };
}

/** Rolling adherence to macro targets over a window. */
export function nutritionAdherence(from: DayKey, to: DayKey) {
  const targets = getTargets();
  const rows = all<{ day: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number }>(
    `SELECT day,
            SUM(n_kcal * ${FACTOR_SQL})      AS kcal,
            SUM(n_protein_g * ${FACTOR_SQL}) AS protein,
            SUM(n_carbs_g * ${FACTOR_SQL})   AS carbs,
            SUM(n_fat_g * ${FACTOR_SQL})     AS fat,
            SUM(n_fiber_g * ${FACTOR_SQL})   AS fiber
     FROM nutrition_entries WHERE planned = 0 AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`,
    [from, to],
  );
  const n = rows.length || 1;
  const hit = (v: number, target: number, tol = 0.1) => Math.abs(v - target) / target <= tol;
  return {
    days: rows.length,
    avgKcal: Math.round(rows.reduce((s, r) => s + r.kcal, 0) / n),
    avgProtein: Math.round(rows.reduce((s, r) => s + r.protein, 0) / n),
    avgCarbs: Math.round(rows.reduce((s, r) => s + r.carbs, 0) / n),
    avgFat: Math.round(rows.reduce((s, r) => s + r.fat, 0) / n),
    avgFiber: Math.round(rows.reduce((s, r) => s + r.fiber, 0) / n),
    kcalHitRate: Math.round((rows.filter((r) => hit(r.kcal, targets.kcal)).length / n) * 100),
    proteinHitRate: Math.round((rows.filter((r) => r.protein >= targets.protein_g * 0.95).length / n) * 100),
    targets,
  };
}

// ---------------------------------------------------------------------------
// Recovery, supplements, protocols
// ---------------------------------------------------------------------------

export function supplementsForDay(day: DayKey) {
  return all<Supplement & { taken: number | null; log_id: string | null }>(
    `SELECT s.*, l.taken AS taken, l.id AS log_id
     FROM supplements s
     LEFT JOIN supplement_logs l ON l.supplement_id = s.id AND l.day = ?
     WHERE s.active = 1
     ORDER BY CASE s.timing WHEN 'am' THEN 0 WHEN 'pre' THEN 1 WHEN 'post' THEN 2
              WHEN 'with_meal' THEN 3 ELSE 4 END, s.name`,
    [day],
  );
}

export function protocolsForDay(day: DayKey) {
  return all<{ id: string; day: string; kind: string; minutes: number; intensity: string; notes: string }>(
    'SELECT id, day, kind, minutes, intensity, notes FROM protocols WHERE day = ? ORDER BY kind',
    [day],
  );
}

export function protocolTotals(from: DayKey, to: DayKey) {
  return all<{ kind: string; sessions: number; minutes: number }>(
    `SELECT kind, COUNT(*) AS sessions, SUM(minutes) AS minutes
     FROM protocols WHERE day BETWEEN ? AND ? GROUP BY kind ORDER BY minutes DESC`,
    [from, to],
  );
}

export function supplementAdherence(from: DayKey, to: DayKey) {
  return all<{ id: string; name: string; due: number; taken: number; pct: number }>(
    `SELECT s.id, s.name, COUNT(l.id) AS due, SUM(l.taken) AS taken,
            ROUND(100.0 * SUM(l.taken) / COUNT(l.id)) AS pct
     FROM supplements s JOIN supplement_logs l ON l.supplement_id = s.id
     WHERE l.day BETWEEN ? AND ? AND s.active = 1
     GROUP BY s.id ORDER BY pct ASC, s.name`,
    [from, to],
  );
}

// ---------------------------------------------------------------------------
// Labs
// ---------------------------------------------------------------------------

export function latestPanel(): { day: DayKey | null; markers: Biomarker[] } {
  const row = one<{ day: string }>('SELECT MAX(day) AS day FROM biomarkers');
  if (!row?.day) return { day: null, markers: [] };
  return {
    day: row.day,
    markers: all<Biomarker>('SELECT * FROM biomarkers WHERE day = ? ORDER BY category, name', [row.day]),
  };
}

export function biomarkerHistory(slug: string): Biomarker[] {
  return all<Biomarker>('SELECT * FROM biomarkers WHERE slug = ? ORDER BY day', [slug]);
}

export function panelDays(): DayKey[] {
  return all<{ day: string }>('SELECT DISTINCT day FROM biomarkers ORDER BY day').map((r) => r.day);
}

export function biomarkerDeltas() {
  const days = panelDays();
  if (days.length < 2) return [];
  const [first, last] = [days[0], days[days.length - 1]];
  return all<{ slug: string; name: string; category: string; unit: string; first_v: number; last_v: number; status: string }>(
    `SELECT a.slug, a.name, a.category, a.unit, a.value AS first_v, b.value AS last_v, b.status
     FROM biomarkers a JOIN biomarkers b ON a.slug = b.slug
     WHERE a.day = ? AND b.day = ? ORDER BY a.category, a.name`,
    [first, last],
  );
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

export function recentSyncRuns(limit = 30): (SyncRunRow & { source_name: string })[] {
  return all<SyncRunRow & { source_name: string }>(
    `SELECT r.*, s.name AS source_name FROM sync_runs r
     JOIN sources s ON s.id = r.source_id
     ORDER BY r.started_at DESC, r.id DESC LIMIT ?`,
    [limit],
  );
}

export function coverage() {
  return {
    workouts: one<{ n: number; first: string; last: string }>(
      'SELECT COUNT(*) n, MIN(day) first, MAX(day) last FROM workouts',
    ),
    sleep: one<{ n: number; first: string; last: string }>(
      'SELECT COUNT(*) n, MIN(day) first, MAX(day) last FROM sleep',
    ),
    recovery: one<{ n: number; first: string; last: string }>(
      'SELECT COUNT(*) n, MIN(day) first, MAX(day) last FROM recovery',
    ),
    nutrition: one<{ n: number; first: string; last: string }>(
      'SELECT COUNT(*) n, MIN(day) first, MAX(day) last FROM nutrition_entries WHERE planned = 0',
    ),
    biomarkers: one<{ n: number; first: string; last: string }>(
      'SELECT COUNT(*) n, MIN(day) first, MAX(day) last FROM biomarkers',
    ),
    body: one<{ n: number; first: string; last: string }>(
      'SELECT COUNT(*) n, MIN(day) first, MAX(day) last FROM body_metrics',
    ),
  };
}

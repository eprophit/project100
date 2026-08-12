import { addDays, diffDays, toDay, today, type DayKey } from '../dates';

/**
 * Deterministic athlete history.
 *
 * This is the *upstream* the demo connectors read from — it stands in for the
 * vendors' servers. Nothing here is a shortcut around the ingestion pipeline:
 * connectors still paginate it, map vendor-native field names, and hand
 * normalised records to the sync engine, which dedupes and upserts them. Swap
 * `transport.ts` for real HTTP and the rest of the stack is unchanged.
 *
 * The history is internally consistent on purpose — HRV responds to acute load
 * and sleep debt, intake tracks expenditure, biomarkers drift with training
 * age — so the overlay charts and correlation readouts show real structure
 * instead of noise.
 */

const HISTORY_DAYS = 400;

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

function hash(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // FNV-1a alone avalanches poorly when inputs differ only in their last few
  // characters — which is exactly the case for consecutive day keys. Without
  // this murmur3 finalizer, "random" draws on adjacent days come out
  // correlated, producing week-long runs of the same outcome (a fortnight with
  // no training, a flat stretch of HRV) instead of independent noise.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform [0,1) keyed by channel, so each signal has independent noise. */
function rand(channel: string, ...parts: (string | number)[]): number {
  return hash(channel, ...parts) / 4294967296;
}

/** Approximately standard-normal, mean 0 sd 1. */
function gauss(channel: string, ...parts: (string | number)[]): number {
  const u = Math.max(1e-9, rand(channel + ':u', ...parts));
  const v = rand(channel + ':v', ...parts);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round(v: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------
// Shapes produced by the simulator (already domain-flavoured, not yet
// vendor-flavoured — each connector re-encodes into its own wire format).
// ---------------------------------------------------------------------------

export interface SimSession {
  key: string;
  day: DayKey;
  startUtc: string;
  modality: 'rowing' | 'cycling' | 'running' | 'strength' | 'swimming' | 'walking' | 'mobility';
  title: string;
  durationS: number;
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  kcal?: number;
  avgWatts?: number;
  normWatts?: number;
  paceS?: number;
  spm?: number;
  load: number;
  rpe?: number;
  intervals?: {
    label: string;
    durationS: number;
    distanceM?: number;
    avgWatts?: number;
    avgHr?: number;
    spm?: number;
    paceS?: number;
  }[];
  sets?: { exercise: string; setNo: number; reps: number; weightKg: number; rpe: number }[];
}

export interface SimDay {
  day: DayKey;
  index: number;
  fitness: number;
  acuteLoad: number;
  chronicLoad: number;
  sessions: SimSession[];
  sleep: {
    bedtime: string;
    wake: string;
    totalMin: number;
    deepMin: number;
    remMin: number;
    lightMin: number;
    awakeMin: number;
    efficiency: number;
    restingHr: number;
    respiratoryRate: number;
  };
  recovery: { rmssd: number; ln: number; restingHr: number; readiness: number; note: string };
  body: { weightKg: number; bodyfatPct: number; leanMassKg: number; vo2max: number };
  nutrition: {
    meal: string;
    food: string;
    brand?: string;
    servings: number;
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sugar: number;
    sodium: number;
  }[];
  protocols: { kind: string; minutes: number; intensity: string; notes?: string }[];
  supplementsSkipped: string[];
}

// ---------------------------------------------------------------------------
// Training plan
// ---------------------------------------------------------------------------

type PlanEntry = { modality: SimSession['modality']; kind: string };

/**
 * A repeating microcycle. Index 0 = Monday. The deload week trims volume rather
 * than dropping sessions, which is what the load curve should show.
 */
const MICROCYCLE: PlanEntry[][] = [
  [{ modality: 'rowing', kind: 'steady' }, { modality: 'strength', kind: 'lower' }],
  [{ modality: 'cycling', kind: 'intervals' }],
  [{ modality: 'rowing', kind: 'intervals' }, { modality: 'mobility', kind: 'flow' }],
  [{ modality: 'running', kind: 'easy' }, { modality: 'strength', kind: 'upper' }],
  [{ modality: 'cycling', kind: 'endurance' }],
  [{ modality: 'rowing', kind: 'long' }],
  [{ modality: 'walking', kind: 'recovery' }, { modality: 'mobility', kind: 'flow' }],
];

function fitnessAt(index: number): number {
  // Saturating growth: fast early adaptation, then diminishing returns.
  return 0.5 + 0.5 * (1 - Math.exp(-index / 210));
}

function isDeload(index: number): boolean {
  return Math.floor(index / 7) % 4 === 3;
}

function wattsToPace500(watts: number): number {
  // Concept2 relation: watts = 2.80 / pace^3, pace in seconds per metre.
  return 500 * Math.cbrt(2.8 / watts);
}

// ---------------------------------------------------------------------------
// Session builders
// ---------------------------------------------------------------------------

function buildRowing(day: DayKey, index: number, kind: string, fitness: number, deload: boolean): SimSession {
  const basePower = 205 + 65 * fitness + gauss('row.pw', day) * 5;
  let durationS: number;
  let avgWatts: number;
  const intervals: NonNullable<SimSession['intervals']> = [];

  if (kind === 'intervals') {
    const reps = deload ? 4 : 6;
    avgWatts = basePower * 1.14;
    durationS = reps * 4 * 60 + (reps - 1) * 3 * 60;
    for (let i = 0; i < reps; i++) {
      const w = avgWatts * (1 + (i - reps / 2) * 0.006 + gauss('row.iv', day, i) * 0.02);
      intervals.push({
        label: `${i + 1} × 4:00`,
        durationS: 240,
        distanceM: Math.round(240 / (wattsToPace500(w) / 500)),
        avgWatts: round(w),
        avgHr: round(158 + i * 2 + gauss('row.ivhr', day, i) * 3),
        spm: round(30 + gauss('row.ivspm', day, i) * 0.8),
        paceS: round(wattsToPace500(w)),
      });
    }
  } else if (kind === 'long') {
    avgWatts = basePower * 0.82;
    durationS = (deload ? 45 : 70) * 60;
  } else {
    avgWatts = basePower * 0.88;
    durationS = (deload ? 32 : 45) * 60;
  }

  const paceS = wattsToPace500(avgWatts);
  const distanceM = Math.round(durationS / (paceS / 500));
  const avgHr = round(
    (kind === 'intervals' ? 162 : kind === 'long' ? 145 : 152) + gauss('row.hr', day) * 4,
  );

  return {
    key: `row-${day}`,
    day,
    startUtc: `${day}T06:${kind === 'intervals' ? '15' : '30'}:00.000Z`,
    modality: 'rowing',
    title: kind === 'intervals' ? '6 × 4:00 / 3:00 rest' : kind === 'long' ? 'Long steady state' : 'Steady state UT2',
    durationS,
    distanceM,
    avgHr,
    maxHr: round(avgHr + (kind === 'intervals' ? 14 : 8)),
    kcal: Math.round((avgWatts * durationS) / 1000 / 4.186 / 0.22),
    avgWatts: round(avgWatts),
    paceS: round(paceS),
    spm: round(kind === 'intervals' ? 29.5 : 21 + gauss('row.spm', day) * 0.6),
    load: round((durationS / 60) * (avgHr / 130) ** 2 * (kind === 'intervals' ? 1.25 : 1)),
    rpe: kind === 'intervals' ? 8 : kind === 'long' ? 6 : 5,
    intervals: intervals.length ? intervals : undefined,
  };
}

function buildCycling(day: DayKey, index: number, kind: string, fitness: number, deload: boolean): SimSession {
  const ftp = 205 + 72 * fitness;
  const durationS = (kind === 'intervals' ? (deload ? 35 : 50) : deload ? 50 : 75) * 60;
  const intensity = kind === 'intervals' ? 0.93 : 0.71;
  const avgWatts = ftp * intensity * (1 + gauss('cyc.pw', day) * 0.03);
  const normWatts = avgWatts * (kind === 'intervals' ? 1.07 : 1.02);
  const avgHr = round((kind === 'intervals' ? 156 : 138) + gauss('cyc.hr', day) * 4);

  return {
    key: `pel-${day}`,
    day,
    startUtc: `${day}T17:45:00.000Z`,
    modality: 'cycling',
    title: kind === 'intervals' ? '45 min Power Zone Max' : '75 min Power Zone Endurance',
    durationS,
    distanceM: Math.round((durationS / 3600) * (28 + 6 * fitness) * 1000),
    avgHr,
    maxHr: round(avgHr + (kind === 'intervals' ? 18 : 10)),
    kcal: Math.round((avgWatts * durationS) / 1000 / 4.186 / 0.23),
    avgWatts: round(avgWatts),
    normWatts: round(normWatts),
    spm: round(88 + gauss('cyc.cad', day) * 3),
    load: round((durationS / 60) * (normWatts / ftp) ** 2 * 1.1),
    rpe: kind === 'intervals' ? 8 : 5,
  };
}

function buildRunning(day: DayKey, index: number, fitness: number, deload: boolean): SimSession {
  const paceS = 335 - 58 * fitness + gauss('run.pace', day) * 8; // seconds per km
  const durationS = (deload ? 28 : 42) * 60;
  const distanceM = Math.round((durationS / paceS) * 1000);
  const avgHr = round(146 + gauss('run.hr', day) * 5);
  return {
    key: `run-${day}`,
    day,
    startUtc: `${day}T07:10:00.000Z`,
    modality: 'running',
    title: 'Easy aerobic run',
    durationS,
    distanceM,
    avgHr,
    maxHr: round(avgHr + 12),
    kcal: Math.round((distanceM / 1000) * 68),
    paceS: round(paceS),
    spm: round(168 + gauss('run.cad', day) * 3),
    load: round((durationS / 60) * (avgHr / 130) ** 2),
    rpe: 4,
  };
}

const LIFTS: Record<string, { name: string; base: number; reps: number }[]> = {
  lower: [
    { name: 'Back Squat', base: 105, reps: 5 },
    { name: 'Romanian Deadlift', base: 95, reps: 8 },
    { name: 'Bulgarian Split Squat', base: 28, reps: 10 },
    { name: 'Calf Raise', base: 60, reps: 12 },
  ],
  upper: [
    { name: 'Bench Press', base: 78, reps: 5 },
    { name: 'Weighted Pull-Up', base: 12, reps: 6 },
    { name: 'Overhead Press', base: 48, reps: 6 },
    { name: 'Barbell Row', base: 72, reps: 8 },
  ],
};

function buildStrength(day: DayKey, index: number, kind: string, fitness: number, deload: boolean): SimSession {
  const lifts = LIFTS[kind] ?? LIFTS.lower;
  const sets: NonNullable<SimSession['sets']> = [];
  // Linear-ish progression on a 4-week wave; deload weeks back off ~12%.
  const progression = 1 + 0.16 * (index / HISTORY_DAYS);
  let volume = 0;

  for (const lift of lifts) {
    for (let s = 1; s <= 3; s++) {
      const weight =
        Math.round((lift.base * progression * (deload ? 0.88 : 1) * (1 + (s - 2) * 0.03)) / 2.5) * 2.5;
      const reps = lift.reps;
      sets.push({ exercise: lift.name, setNo: s, reps, weightKg: weight, rpe: deload ? 6 : 7 + s * 0.5 });
      volume += weight * reps;
    }
  }

  const durationS = (deload ? 40 : 55) * 60;
  return {
    key: `str-${day}`,
    day,
    startUtc: `${day}T18:30:00.000Z`,
    modality: 'strength',
    title: kind === 'lower' ? 'Lower body strength' : 'Upper body strength',
    durationS,
    avgHr: round(118 + gauss('str.hr', day) * 5),
    kcal: Math.round(durationS / 60 * 7.5),
    load: round((durationS / 60) * 0.85 + volume / 900),
    rpe: deload ? 6 : 8,
    sets,
  };
}

function buildEasy(day: DayKey, modality: 'walking' | 'mobility' | 'swimming'): SimSession {
  const durationS = (modality === 'walking' ? 48 : 25) * 60;
  return {
    key: `${modality}-${day}`,
    day,
    startUtc: `${day}T12:15:00.000Z`,
    modality,
    title: modality === 'walking' ? 'Zone 1 walk' : 'Mobility flow',
    durationS,
    distanceM: modality === 'walking' ? Math.round((durationS / 3600) * 5200) : undefined,
    avgHr: round(modality === 'walking' ? 98 : 88),
    kcal: Math.round((durationS / 60) * (modality === 'walking' ? 4.4 : 3.1)),
    load: round((durationS / 60) * 0.28),
    rpe: 2,
  };
}

// ---------------------------------------------------------------------------
// Whole-history generation
// ---------------------------------------------------------------------------

let cache: { anchor: DayKey; days: SimDay[] } | null = null;

export function historyStart(): DayKey {
  return addDays(today(), -(HISTORY_DAYS - 1));
}

export function simulate(): SimDay[] {
  const anchor = today();
  if (cache && cache.anchor === anchor) return cache.days;

  const start = historyStart();
  const days: SimDay[] = [];

  // Exponentially-weighted load averages, carried forward across days.
  let acute = 55;
  let chronic = 55;

  for (let i = 0; i < HISTORY_DAYS; i++) {
    const day = addDays(start, i);
    const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    const fitness = fitnessAt(i);
    const deload = isDeload(i);

    // --- Sessions ---------------------------------------------------------
    const sessions: SimSession[] = [];
    const missed = rand('miss', day) < 0.07; // life happens
    if (!missed) {
      for (const entry of MICROCYCLE[dow]) {
        switch (entry.modality) {
          case 'rowing':
            sessions.push(buildRowing(day, i, entry.kind, fitness, deload));
            break;
          case 'cycling':
            sessions.push(buildCycling(day, i, entry.kind, fitness, deload));
            break;
          case 'running':
            sessions.push(buildRunning(day, i, fitness, deload));
            break;
          case 'strength':
            sessions.push(buildStrength(day, i, entry.kind, fitness, deload));
            break;
          default:
            sessions.push(buildEasy(day, entry.modality));
        }
      }
    }

    const dayLoad = sessions.reduce((sum, s) => sum + s.load, 0);
    acute = acute + (dayLoad - acute) / 7;
    chronic = chronic + (dayLoad - chronic) / 42;
    const strain = clamp((acute - chronic) / Math.max(chronic, 1), -0.6, 0.9);

    // --- Sleep ------------------------------------------------------------
    // Hard evening sessions push bedtime later and cost deep sleep.
    const lateSession = sessions.some((s) => s.startUtc.slice(11, 13) >= '17' && (s.rpe ?? 0) >= 7);
    const totalMin = clamp(
      450 + gauss('sleep.total', day) * 38 - (lateSession ? 22 : 0) - strain * 25,
      300,
      560,
    );
    const efficiency = clamp(91 - strain * 4 + gauss('sleep.eff', day) * 2.4, 76, 98);
    const deepMin = clamp(totalMin * (0.19 - strain * 0.02) + gauss('sleep.deep', day) * 8, 40, 140);
    const remMin = clamp(totalMin * 0.22 + gauss('sleep.rem', day) * 10, 45, 150);
    const awakeMin = clamp(totalMin * (1 - efficiency / 100), 4, 70);
    const lightMin = Math.max(30, totalMin - deepMin - remMin - awakeMin);

    // --- Recovery (next-morning readings respond to yesterday's strain) ---
    // Coefficients are set so acute-load strain and sleep debt dominate the
    // day-to-day variance rather than the noise term. Measurement noise on a
    // single subject is real, but if it outweighs the physiology the overlay
    // charts show nothing and the correlation panel reports r ≈ 0 — which
    // would make the app's central feature look broken rather than honest.
    const sleepDebt = (totalMin - 450) / 60; // hours above/below a 7.5 h night
    const rmssd = clamp(
      58 + 20 * fitness - strain * 30 + sleepDebt * 5 + gauss('hrv.rmssd', day) * 3.6,
      22,
      125,
    );
    const restingHr = clamp(
      55 - 6 * fitness + strain * 7 - sleepDebt * 1.4 + gauss('hrv.rhr', day) * 1.1,
      38,
      72,
    );
    const readiness = clamp(
      52 + (rmssd - 65) * 0.9 - strain * 22 + sleepDebt * 6 + gauss('hrv.rdy', day) * 2.6,
      15,
      99,
    );

    // --- Body -------------------------------------------------------------
    const weightKg = round(82.6 - 3.1 * (i / HISTORY_DAYS) + gauss('body.wt', day) * 0.42, 2);
    const bodyfatPct = round(17.4 - 4.3 * (i / HISTORY_DAYS) + gauss('body.bf', day) * 0.32, 1);

    // --- Nutrition (intake tracks expenditure with a lag and some slippage)
    const targetKcal = 2180 + dayLoad * 2.35;
    const kcal = clamp(targetKcal * (1 + gauss('nut.k', day) * 0.075), 1700, 4200);
    const protein = clamp(weightKg * 2.05 + gauss('nut.p', day) * 12, 110, 230);
    const fat = clamp((kcal * 0.29) / 9 + gauss('nut.f', day) * 6, 45, 130);
    const carbs = clamp((kcal - protein * 4 - fat * 9) / 4, 140, 560);
    const nutrition = splitIntoMeals(day, kcal, protein, carbs, fat);

    // --- Recovery protocols ----------------------------------------------
    const protocols: SimDay['protocols'] = [];
    if ((dayLoad > 70 && rand('proto.sauna', day) < 0.62) || rand('proto.sauna2', day) < 0.12) {
      protocols.push({ kind: 'sauna', minutes: 20 + Math.round(rand('proto.sm', day) * 12), intensity: '82°C' });
    }
    if (rand('proto.cold', day) < 0.34) {
      protocols.push({ kind: 'cold_plunge', minutes: 3 + Math.round(rand('proto.cm', day) * 3), intensity: '9°C' });
    }
    if (rand('proto.breath', day) < 0.28) {
      protocols.push({ kind: 'breathwork', minutes: 10, intensity: 'box 4-4-4-4' });
    }
    if (dow === 6 && rand('proto.massage', day) < 0.3) {
      protocols.push({ kind: 'massage', minutes: 60, intensity: 'deep tissue' });
    }

    // --- Supplement adherence --------------------------------------------
    const supplementsSkipped: string[] = [];
    if (rand('supp.skip', day) < 0.11) supplementsSkipped.push('all-pm');
    if (rand('supp.skip2', day) < 0.06) supplementsSkipped.push('all-am');

    days.push({
      day,
      index: i,
      fitness: round(fitness, 3),
      acuteLoad: round(acute),
      chronicLoad: round(chronic),
      sessions,
      sleep: {
        bedtime: `${addDays(day, -1)}T22:${String(Math.round(rand('sleep.bt', day) * 39) + 20).padStart(2, '0')}:00.000Z`,
        wake: `${day}T06:${String(Math.round(rand('sleep.wk', day) * 45) + 10).padStart(2, '0')}:00.000Z`,
        totalMin: round(totalMin),
        deepMin: round(deepMin),
        remMin: round(remMin),
        lightMin: round(lightMin),
        awakeMin: round(awakeMin),
        efficiency: round(efficiency),
        restingHr: round(restingHr),
        respiratoryRate: round(14.2 + gauss('sleep.rr', day) * 0.6, 1),
      },
      recovery: {
        rmssd: round(rmssd),
        ln: round(Math.log(rmssd), 2),
        restingHr: round(restingHr),
        readiness: Math.round(readiness),
        note: readiness > 75 ? 'Go' : readiness > 50 ? 'Moderate' : 'Take it easy',
      },
      body: {
        weightKg,
        bodyfatPct,
        leanMassKg: round(weightKg * (1 - bodyfatPct / 100), 2),
        vo2max: round(48 + 9 * fitness + gauss('body.vo2', day) * 0.5, 1),
      },
      nutrition,
      protocols,
      supplementsSkipped,
    });
  }

  cache = { anchor, days };
  return days;
}

const MEAL_TEMPLATES = [
  { meal: 'breakfast', share: 0.24, foods: ['Greek yogurt bowl', 'Oats, berries & whey', 'Three-egg omelette'] },
  { meal: 'lunch', share: 0.31, foods: ['Chicken & rice bowl', 'Salmon poke bowl', 'Turkey wrap & salad'] },
  { meal: 'dinner', share: 0.33, foods: ['Steak, potatoes & greens', 'Cod, quinoa & broccoli', 'Beef chilli & rice'] },
  { meal: 'snack', share: 0.12, foods: ['Whey shake & banana', 'Cottage cheese & almonds', 'Protein bar'] },
];

function splitIntoMeals(
  day: DayKey,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
): SimDay['nutrition'] {
  return MEAL_TEMPLATES.map((t, i) => {
    const jitter = 1 + gauss('meal', day, i) * 0.08;
    const share = t.share * jitter;
    const food = t.foods[hash('food', day, i) % t.foods.length];
    return {
      meal: t.meal,
      food,
      servings: 1,
      kcal: Math.round(kcal * share),
      protein: round(protein * share * (t.meal === 'snack' ? 1.5 : 0.95)),
      carbs: round(carbs * share),
      fat: round(fat * share),
      fiber: round((38 * share) as number),
      sugar: round(kcal * share * 0.06),
      sodium: Math.round(2200 * share),
    };
  });
}

// ---------------------------------------------------------------------------
// Biomarker panels
// ---------------------------------------------------------------------------

export interface SimBiomarker {
  day: DayKey;
  panel: string;
  category: string;
  name: string;
  slug: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  optimalLow: number | null;
  optimalHigh: number | null;
}

interface MarkerSpec {
  name: string;
  slug: string;
  category: string;
  unit: string;
  start: number;
  end: number; // value at the most recent panel — the training effect
  refLow: number | null;
  refHigh: number | null;
  optimalLow: number | null;
  optimalHigh: number | null;
  dp?: number;
}

const MARKERS: MarkerSpec[] = [
  // Heart
  { name: 'ApoB', slug: 'apob', category: 'Heart', unit: 'mg/dL', start: 104, end: 78, refLow: null, refHigh: 90, optimalLow: null, optimalHigh: 80, dp: 0 },
  { name: 'LDL Cholesterol', slug: 'ldl', category: 'Heart', unit: 'mg/dL', start: 138, end: 101, refLow: null, refHigh: 130, optimalLow: null, optimalHigh: 100, dp: 0 },
  { name: 'HDL Cholesterol', slug: 'hdl', category: 'Heart', unit: 'mg/dL', start: 51, end: 63, refLow: 40, refHigh: null, optimalLow: 60, optimalHigh: null, dp: 0 },
  { name: 'Triglycerides', slug: 'triglycerides', category: 'Heart', unit: 'mg/dL', start: 128, end: 74, refLow: null, refHigh: 150, optimalLow: null, optimalHigh: 90, dp: 0 },
  { name: 'Lipoprotein(a)', slug: 'lpa', category: 'Heart', unit: 'nmol/L', start: 32, end: 31, refLow: null, refHigh: 75, optimalLow: null, optimalHigh: 50, dp: 0 },
  // Metabolic
  { name: 'HbA1c', slug: 'hba1c', category: 'Metabolic', unit: '%', start: 5.5, end: 5.1, refLow: null, refHigh: 5.7, optimalLow: null, optimalHigh: 5.3, dp: 1 },
  { name: 'Fasting Glucose', slug: 'glucose', category: 'Metabolic', unit: 'mg/dL', start: 96, end: 87, refLow: 70, refHigh: 99, optimalLow: 75, optimalHigh: 90, dp: 0 },
  { name: 'Fasting Insulin', slug: 'insulin', category: 'Metabolic', unit: 'µIU/mL', start: 9.4, end: 5.1, refLow: 2, refHigh: 19.6, optimalLow: 2, optimalHigh: 6, dp: 1 },
  { name: 'HOMA-IR', slug: 'homa_ir', category: 'Metabolic', unit: 'index', start: 2.2, end: 1.1, refLow: null, refHigh: 2.5, optimalLow: null, optimalHigh: 1.4, dp: 2 },
  // Inflammation
  { name: 'hs-CRP', slug: 'hscrp', category: 'Inflammation', unit: 'mg/L', start: 2.4, end: 0.7, refLow: null, refHigh: 3, optimalLow: null, optimalHigh: 1, dp: 2 },
  { name: 'Homocysteine', slug: 'homocysteine', category: 'Inflammation', unit: 'µmol/L', start: 11.8, end: 8.4, refLow: null, refHigh: 15, optimalLow: null, optimalHigh: 9, dp: 1 },
  // Hormones
  { name: 'Total Testosterone', slug: 'testosterone_total', category: 'Hormones', unit: 'ng/dL', start: 512, end: 648, refLow: 264, refHigh: 916, optimalLow: 550, optimalHigh: 900, dp: 0 },
  { name: 'Free Testosterone', slug: 'testosterone_free', category: 'Hormones', unit: 'pg/mL', start: 10.2, end: 14.1, refLow: 6.8, refHigh: 21.5, optimalLow: 12, optimalHigh: 21, dp: 1 },
  { name: 'SHBG', slug: 'shbg', category: 'Hormones', unit: 'nmol/L', start: 41, end: 38, refLow: 16.5, refHigh: 55.9, optimalLow: 25, optimalHigh: 45, dp: 0 },
  { name: 'Cortisol (AM)', slug: 'cortisol', category: 'Hormones', unit: 'µg/dL', start: 18.4, end: 13.9, refLow: 6.2, refHigh: 19.4, optimalLow: 10, optimalHigh: 16, dp: 1 },
  { name: 'DHEA-S', slug: 'dheas', category: 'Hormones', unit: 'µg/dL', start: 286, end: 331, refLow: 138, refHigh: 475, optimalLow: 250, optimalHigh: 450, dp: 0 },
  // Thyroid
  { name: 'TSH', slug: 'tsh', category: 'Thyroid', unit: 'µIU/mL', start: 2.4, end: 1.7, refLow: 0.45, refHigh: 4.5, optimalLow: 0.5, optimalHigh: 2.5, dp: 2 },
  { name: 'Free T3', slug: 'ft3', category: 'Thyroid', unit: 'pg/mL', start: 3.1, end: 3.4, refLow: 2, refHigh: 4.4, optimalLow: 3, optimalHigh: 4, dp: 1 },
  { name: 'Free T4', slug: 'ft4', category: 'Thyroid', unit: 'ng/dL', start: 1.2, end: 1.3, refLow: 0.82, refHigh: 1.77, optimalLow: 1.1, optimalHigh: 1.6, dp: 2 },
  // Blood / nutrients
  { name: 'Ferritin', slug: 'ferritin', category: 'Blood', unit: 'ng/mL', start: 58, end: 96, refLow: 30, refHigh: 400, optimalLow: 70, optimalHigh: 200, dp: 0 },
  { name: 'Hemoglobin', slug: 'hemoglobin', category: 'Blood', unit: 'g/dL', start: 14.6, end: 15.2, refLow: 13.2, refHigh: 17.1, optimalLow: 14, optimalHigh: 16.5, dp: 1 },
  { name: 'Hematocrit', slug: 'hematocrit', category: 'Blood', unit: '%', start: 43.2, end: 45.1, refLow: 38.5, refHigh: 50, optimalLow: 42, optimalHigh: 48, dp: 1 },
  { name: 'Vitamin D (25-OH)', slug: 'vitamin_d', category: 'Nutrients', unit: 'ng/mL', start: 27, end: 54, refLow: 30, refHigh: 100, optimalLow: 45, optimalHigh: 80, dp: 0 },
  { name: 'Vitamin B12', slug: 'b12', category: 'Nutrients', unit: 'pg/mL', start: 412, end: 588, refLow: 232, refHigh: 1245, optimalLow: 500, optimalHigh: 1000, dp: 0 },
  { name: 'Magnesium (RBC)', slug: 'magnesium_rbc', category: 'Nutrients', unit: 'mg/dL', start: 4.9, end: 5.8, refLow: 4, refHigh: 6.4, optimalLow: 5.4, optimalHigh: 6.4, dp: 1 },
  { name: 'Omega-3 Index', slug: 'omega3_index', category: 'Nutrients', unit: '%', start: 4.2, end: 7.9, refLow: 4, refHigh: null, optimalLow: 8, optimalHigh: null, dp: 1 },
  // Kidney / liver
  { name: 'Creatinine', slug: 'creatinine', category: 'Kidney', unit: 'mg/dL', start: 1.08, end: 1.12, refLow: 0.76, refHigh: 1.27, optimalLow: 0.8, optimalHigh: 1.2, dp: 2 },
  { name: 'eGFR', slug: 'egfr', category: 'Kidney', unit: 'mL/min/1.73m²', start: 92, end: 94, refLow: 59, refHigh: null, optimalLow: 90, optimalHigh: null, dp: 0 },
  { name: 'ALT', slug: 'alt', category: 'Liver', unit: 'U/L', start: 31, end: 22, refLow: 0, refHigh: 44, optimalLow: 10, optimalHigh: 26, dp: 0 },
  { name: 'GGT', slug: 'ggt', category: 'Liver', unit: 'U/L', start: 29, end: 18, refLow: 3, refHigh: 60, optimalLow: 5, optimalHigh: 24, dp: 0 },
];

/** Panels are drawn at roughly quarterly intervals across the history window. */
export function biomarkerPanels(): SimBiomarker[] {
  const start = historyStart();
  const offsets = [12, 118, 236, 348];
  const out: SimBiomarker[] = [];

  offsets.forEach((offset, panelIdx) => {
    const day = addDays(start, offset);
    if (diffDays(day, today()) < 0) return;
    const t = offsets.length === 1 ? 1 : panelIdx / (offsets.length - 1);
    for (const m of MARKERS) {
      // Ease toward the end value, with per-draw analytical noise.
      const eased = m.start + (m.end - m.start) * (t * t * (3 - 2 * t));
      const noise = 1 + gauss('marker', m.slug, panelIdx) * 0.035;
      out.push({
        day,
        panel: `Function Health Panel ${panelIdx + 1}`,
        category: m.category,
        name: m.name,
        slug: m.slug,
        value: round(eased * noise, m.dp ?? 1),
        unit: m.unit,
        refLow: m.refLow,
        refHigh: m.refHigh,
        optimalLow: m.optimalLow,
        optimalHigh: m.optimalHigh,
      });
    }
  });

  return out;
}

export function simDayMap(): Map<DayKey, SimDay> {
  const map = new Map<DayKey, SimDay>();
  for (const d of simulate()) map.set(d.day, d);
  return map;
}

export { HISTORY_DAYS, toDay };

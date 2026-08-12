import type { DayKey } from './dates';

export type DomainKind =
  | 'workouts'
  | 'sleep'
  | 'recovery'
  | 'nutrition'
  | 'body'
  | 'biomarkers'
  | 'protocols';

export type Modality =
  | 'rowing'
  | 'cycling'
  | 'running'
  | 'strength'
  | 'swimming'
  | 'walking'
  | 'mobility';

export const MODALITIES: Modality[] = [
  'rowing',
  'cycling',
  'running',
  'strength',
  'swimming',
  'walking',
  'mobility',
];

export interface SourceRow {
  id: string;
  name: string;
  vendor: string;
  domains: string;
  auth_mode: 'oauth' | 'token' | 'file_export';
  enabled: number;
  mode: 'demo' | 'live';
  cursor: string | null;
  last_sync_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface SyncRunRow {
  id: number;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'partial' | 'error';
  pages: number;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  retries: number;
  error: string | null;
}

export interface Workout {
  id: string;
  source_id: string;
  external_id: string;
  start_utc: string;
  day: DayKey;
  modality: Modality;
  title: string | null;
  duration_s: number;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  kcal: number | null;
  avg_watts: number | null;
  norm_watts: number | null;
  pace_s: number | null;
  spm: number | null;
  load: number;
  perceived: number | null;
}

export interface SleepRow {
  day: DayKey;
  total_min: number | null;
  deep_min: number | null;
  rem_min: number | null;
  light_min: number | null;
  awake_min: number | null;
  efficiency: number | null;
  resting_hr: number | null;
  respiratory_rate: number | null;
}

export interface RecoveryRow {
  day: DayKey;
  hrv_rmssd: number | null;
  hrv_ln: number | null;
  resting_hr: number | null;
  readiness: number | null;
  note: string | null;
}

export interface NutritionEntry {
  id: string;
  day: DayKey;
  meal: string;
  food: string;
  brand: string | null;
  servings: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
  planned: number;
}

export interface Food {
  id: string;
  name: string;
  brand: string | null;
  serving: string;
  serving_g: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
  tags: string | null;
}

export interface Supplement {
  id: string;
  name: string;
  brand: string | null;
  dose: number | null;
  unit: string | null;
  timing: string | null;
  purpose: string | null;
  cadence: string;
  active: number;
  started_on: string | null;
  notes: string | null;
}

export interface Biomarker {
  id: string;
  day: DayKey;
  panel: string | null;
  category: string;
  name: string;
  slug: string;
  value: number;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  optimal_low: number | null;
  optimal_high: number | null;
  status: 'optimal' | 'in_range' | 'out_of_range' | null;
}

export interface MacroTargets {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
}

/**
 * Starting targets, set for an ~79 kg athlete training 10–12 h a week:
 * protein at ~2 g/kg, the rest split around a maintenance estimate. Editable
 * per user; these only apply to a fresh install.
 */
export const DEFAULT_TARGETS: MacroTargets = {
  kcal: 2400,
  protein_g: 165,
  carbs_g: 270,
  fat_g: 78,
  fiber_g: 38,
  sodium_mg: 2300,
};

/** A single (day, value) sample of one metric. */
export interface Point {
  day: DayKey;
  value: number;
}

export interface Series {
  metric: string;
  label: string;
  unit: string;
  points: Point[];
}

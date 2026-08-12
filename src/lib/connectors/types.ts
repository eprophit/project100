import type { DayKey } from '../dates';
import type { DomainKind, Modality } from '../types';

// ---------------------------------------------------------------------------
// Normalised records. Every connector maps its vendor payload into these; the
// sync engine only ever sees this shape.
// ---------------------------------------------------------------------------

export interface IntervalInput {
  label: string;
  durationS?: number;
  distanceM?: number;
  avgWatts?: number;
  avgHr?: number;
  spm?: number;
  paceS?: number;
}

export interface StrengthSetInput {
  exercise: string;
  setNo: number;
  reps: number;
  weightKg: number;
  rpe?: number;
}

export interface WorkoutInput {
  externalId: string;
  startUtc: string;
  day: DayKey;
  modality: Modality;
  title?: string;
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
  perceived?: number;
  raw?: unknown;
  intervals?: IntervalInput[];
  sets?: StrengthSetInput[];
}

export interface SleepInput {
  externalId: string;
  day: DayKey;
  bedtime?: string;
  wakeTime?: string;
  totalMin?: number;
  deepMin?: number;
  remMin?: number;
  lightMin?: number;
  awakeMin?: number;
  efficiency?: number;
  restingHr?: number;
  respiratoryRate?: number;
  raw?: unknown;
}

export interface RecoveryInput {
  externalId: string;
  day: DayKey;
  hrvRmssd?: number;
  hrvLn?: number;
  restingHr?: number;
  readiness?: number;
  note?: string;
  raw?: unknown;
}

export interface NutritionInput {
  externalId: string;
  day: DayKey;
  meal: string;
  food: string;
  brand?: string;
  servings?: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
  loggedAt?: string;
}

export interface BodyInput {
  externalId: string;
  day: DayKey;
  weightKg?: number;
  bodyfatPct?: number;
  leanMassKg?: number;
  vo2max?: number;
}

export interface BiomarkerInput {
  externalId: string;
  day: DayKey;
  panel?: string;
  category: string;
  name: string;
  slug: string;
  value: number;
  unit?: string;
  refLow?: number | null;
  refHigh?: number | null;
  optimalLow?: number | null;
  optimalHigh?: number | null;
}

export interface ProtocolInput {
  externalId: string;
  day: DayKey;
  kind: string;
  minutes?: number;
  intensity?: string;
  notes?: string;
}

export interface NormalizedBatch {
  workouts?: WorkoutInput[];
  sleep?: SleepInput[];
  recovery?: RecoveryInput[];
  nutrition?: NutritionInput[];
  body?: BodyInput[];
  biomarkers?: BiomarkerInput[];
  protocols?: ProtocolInput[];
}

// ---------------------------------------------------------------------------
// Connector contract
// ---------------------------------------------------------------------------

export interface FetchContext {
  /** Inclusive lower bound derived from the stored cursor. */
  since: DayKey;
  /** Opaque cursor from the previous page, or null to start the window. */
  cursor: string | null;
  /** Attempt number for this page, starting at 1. Used to model flaky calls. */
  attempt: number;
}

export interface FetchPage {
  /** Raw, vendor-shaped records. Deliberately untyped at the engine boundary. */
  records: unknown[];
  /** Cursor to pass to the next call, or null when the window is exhausted. */
  nextCursor: string | null;
}

export interface Connector {
  id: string;
  name: string;
  vendor: string;
  /** What this source can contribute; drives the Connections page badges. */
  domains: DomainKind[];
  authMode: 'oauth' | 'token' | 'file_export';
  /** Env var that flips this connector from demo to live. */
  credentialEnv: string;
  /** Human note about the real integration, shown in the UI. */
  integrationNote: string;
  /** How far back a first-ever sync should reach. */
  backfillDays: number;

  fetchPage(ctx: FetchContext): Promise<FetchPage>;
  normalize(records: unknown[]): NormalizedBatch;
}

/** Thrown for retryable upstream conditions (429, 5xx, socket resets). */
export class TransientUpstreamError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs = 250) {
    super(message);
    this.name = 'TransientUpstreamError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Thrown when a connector is in live mode but the integration isn't wired. */
export class NotConfiguredError extends Error {
  constructor(connector: string, envVar: string) {
    super(
      `${connector} is in live mode (${envVar} is set) but the live HTTP client is not implemented. ` +
        `Implement fetchPage()'s live branch in src/lib/connectors/${connector}.ts, or unset ${envVar} to use demo mode.`,
    );
    this.name = 'NotConfiguredError';
  }
}

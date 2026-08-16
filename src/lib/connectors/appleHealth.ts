import { scanAppleExport } from '../imports/appleHealthXml';
import { simDayMap } from '../sim/athlete';
import { daysInWindow, pageWindow, simulateCall } from './transport';
import {
  type BodyInput,
  type Connector,
  type FetchContext,
  type FetchPage,
  type NormalizedBatch,
  type SleepInput,
  type StrengthSetInput,
  type WorkoutInput,
} from './types';

/**
 * Apple Health.
 *
 * This is the messiest mapper of the six, which is representative — the export
 * is a flat stream of heterogeneous samples rather than domain objects:
 *  - sleep arrives as many per-stage **segments** that must be folded into one
 *    night, keyed to the wake day rather than the bedtime day.
 *  - `HKQuantityTypeIdentifierBodyFatPercentage` is a **fraction** (0–1).
 *  - workout `duration` is in **minutes**, `totalDistance` in **kilometres**.
 *  - dates are `YYYY-MM-DD HH:MM:SS ±ZZZZ`, not ISO-8601.
 *  - set-level strength data only exists as a JSON string inside workout
 *    `metadata`, written there by whichever third-party app recorded it.
 */

const PAGE_DAYS = 45;

type SampleType =
  | 'HKCategoryTypeIdentifierSleepAnalysis'
  | 'HKQuantityTypeIdentifierRestingHeartRate'
  | 'HKQuantityTypeIdentifierRespiratoryRate'
  | 'HKQuantityTypeIdentifierBodyMass'
  | 'HKQuantityTypeIdentifierBodyFatPercentage'
  | 'HKQuantityTypeIdentifierLeanBodyMass'
  | 'HKQuantityTypeIdentifierVO2Max';

interface HKSample {
  kind: 'sample';
  type: SampleType;
  sourceName: string;
  startDate: string;
  endDate: string;
  value: string | number;
  unit?: string;
}

interface HKWorkout {
  kind: 'workout';
  workoutActivityType: string;
  sourceName: string;
  startDate: string;
  endDate: string;
  duration: number; // MINUTES
  durationUnit: 'min';
  totalDistance?: number; // KILOMETRES
  totalDistanceUnit?: 'km';
  totalEnergyBurned?: number;
  totalEnergyBurnedUnit?: 'kcal';
  metadata: Record<string, string>;
}

type HKRecord = HKSample | HKWorkout;

const ACTIVITY_MAP: Record<string, WorkoutInput['modality']> = {
  HKWorkoutActivityTypeRunning: 'running',
  HKWorkoutActivityTypeTraditionalStrengthTraining: 'strength',
  HKWorkoutActivityTypeWalking: 'walking',
  HKWorkoutActivityTypeYoga: 'mobility',
  HKWorkoutActivityTypeSwimming: 'swimming',
};

/** HealthKit has no workout title, so one is derived from the activity type. */
const WORKOUT_TITLE: Record<WorkoutInput['modality'], string> = {
  running: 'Easy aerobic run',
  strength: 'Strength session',
  walking: 'Zone 1 walk',
  mobility: 'Mobility flow',
  swimming: 'Swim',
  rowing: 'Row',
  cycling: 'Ride',
};

/** Apple's export format: `2025-06-01 06:30:00 +0000`. */
function hkDate(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} +0000`;
}

function parseHkDate(s: string): string {
  const [date, time] = s.split(' ');
  return `${date}T${time}.000Z`;
}

/**
 * Which night a sleep segment belongs to.
 *
 * A night is named for the morning you wake up on, so a segment starting at
 * 23:10 belongs to the *next* day. Keying on the segment's end instead is the
 * obvious shortcut and it is wrong: the pre-midnight part of tonight's sleep
 * ends today, so it lands on last night, dragging that night's bedtime and
 * wake time a full day apart. The evening cutoff is what makes an afternoon nap
 * stay on its own day while a 23:00 bedtime rolls forward.
 */
function nightKeyFor(startUtc: string): string {
  const hour = Number(startUtc.slice(11, 13));
  if (hour < 18) return startUtc.slice(0, 10);
  const d = new Date(startUtc);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const appleHealth: Connector = {
  id: 'apple_health',
  name: 'Apple Health',
  vendor: 'Apple',
  domains: ['sleep', 'body', 'workouts'],
  authMode: 'file_export',
  credentialEnv: 'APPLE_HEALTH_EXPORT_DIR',
  liveVia: 'file_import',
  integrationNote:
    'HealthKit has no cloud API — data only leaves the phone as a file. Upload export.zip here, or set APPLE_HEALTH_EXPORT_DIR to a folder and every export dropped in it is ingested on the next sync.',
  backfillDays: 400,

  fileImport: {
    instructions:
      'On your iPhone: Health → your profile picture → Export All Health Data. Share the resulting export.zip to this machine and upload it here — no need to unzip it.',
    accept: ['.zip', '.xml'],
    matches(file) {
      if (/^export.*\.(zip|xml)$/i.test(file.filename)) return true;
      // A renamed file is still recognisable from its first bytes.
      return file.head.includes('<HealthData') || file.head.includes('HKCharacteristicTypeIdentifier');
    },
    async parse(file) {
      const { records } = await scanAppleExport(file.path, file.filename);
      return normalizeAppleRecords(records);
    },
  },

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    const window = pageWindow(ctx.since, ctx.cursor, PAGE_DAYS);
    await simulateCall('apple_health', window, ctx.attempt);

    const sim = simDayMap();
    const records: HKRecord[] = [];

    for (const day of daysInWindow(window)) {
      const d = sim.get(day);
      if (!d) continue;

      // --- Sleep, emitted as per-stage segments across the night -----------
      const stages: [string, number][] = [
        ['HKCategoryValueSleepAnalysisAsleepDeep', d.sleep.deepMin],
        ['HKCategoryValueSleepAnalysisAsleepREM', d.sleep.remMin],
        ['HKCategoryValueSleepAnalysisAsleepCore', d.sleep.lightMin],
        ['HKCategoryValueSleepAnalysisAwake', d.sleep.awakeMin],
      ];
      let cursorMs = new Date(d.sleep.bedtime).getTime();
      // Interleave so a night looks like real cycles rather than four blocks.
      for (let cycle = 0; cycle < 4; cycle++) {
        for (const [value, totalMin] of stages) {
          const segMin = totalMin / 4;
          const start = cursorMs;
          const end = start + segMin * 60_000;
          records.push({
            kind: 'sample',
            type: 'HKCategoryTypeIdentifierSleepAnalysis',
            sourceName: 'Apple Watch',
            startDate: hkDate(new Date(start).toISOString()),
            endDate: hkDate(new Date(end).toISOString()),
            value,
          });
          cursorMs = end;
        }
      }

      records.push(
        {
          kind: 'sample',
          type: 'HKQuantityTypeIdentifierRestingHeartRate',
          sourceName: 'Apple Watch',
          startDate: hkDate(d.sleep.wake),
          endDate: hkDate(d.sleep.wake),
          value: d.sleep.restingHr,
          unit: 'count/min',
        },
        {
          kind: 'sample',
          type: 'HKQuantityTypeIdentifierRespiratoryRate',
          sourceName: 'Apple Watch',
          startDate: hkDate(d.sleep.wake),
          endDate: hkDate(d.sleep.wake),
          value: d.sleep.respiratoryRate,
          unit: 'count/min',
        },
        {
          kind: 'sample',
          type: 'HKQuantityTypeIdentifierBodyMass',
          sourceName: 'Withings Body+',
          startDate: hkDate(`${day}T07:05:00.000Z`),
          endDate: hkDate(`${day}T07:05:00.000Z`),
          value: d.body.weightKg,
          unit: 'kg',
        },
        {
          kind: 'sample',
          type: 'HKQuantityTypeIdentifierBodyFatPercentage',
          sourceName: 'Withings Body+',
          startDate: hkDate(`${day}T07:05:00.000Z`),
          endDate: hkDate(`${day}T07:05:00.000Z`),
          // HealthKit stores this as a fraction, not a percentage.
          value: d.body.bodyfatPct / 100,
          unit: '%',
        },
        {
          kind: 'sample',
          type: 'HKQuantityTypeIdentifierVO2Max',
          sourceName: 'Apple Watch',
          startDate: hkDate(`${day}T07:05:00.000Z`),
          endDate: hkDate(`${day}T07:05:00.000Z`),
          value: d.body.vo2max,
          unit: 'mL/min·kg',
        },
      );

      // --- Workouts Apple owns (everything not on the erg or the bike) -----
      for (const s of d.sessions) {
        if (s.modality === 'rowing' || s.modality === 'cycling') continue;
        const activity = Object.entries(ACTIVITY_MAP).find(([, v]) => v === s.modality)?.[0];
        if (!activity) continue;

        const metadata: Record<string, string> = {
          HKIndoorWorkout: s.modality === 'strength' ? '1' : '0',
          HKAverageHeartRate: String(Math.round(s.avgHr ?? 0)),
          HKMaximumHeartRate: String(Math.round(s.maxHr ?? s.avgHr ?? 0)),
          HKWorkoutBrandName: s.modality === 'strength' ? 'Hevy' : 'Apple Watch',
        };
        if (s.sets?.length) {
          // Third-party lifting apps round-trip set data through metadata as a
          // JSON blob; HealthKit itself has no concept of a set.
          metadata['HevySetsJSON'] = JSON.stringify(
            s.sets.map((set) => ({
              ex: set.exercise,
              n: set.setNo,
              reps: set.reps,
              kg: set.weightKg,
              rpe: set.rpe,
            })),
          );
        }
        if (s.paceS) metadata['HKAveragePace'] = String(s.paceS);

        records.push({
          kind: 'workout',
          workoutActivityType: activity,
          sourceName: metadata['HKWorkoutBrandName'],
          startDate: hkDate(s.startUtc),
          endDate: hkDate(new Date(new Date(s.startUtc).getTime() + s.durationS * 1000).toISOString()),
          duration: Math.round((s.durationS / 60) * 100) / 100,
          durationUnit: 'min',
          totalDistance: s.distanceM ? Math.round((s.distanceM / 1000) * 1000) / 1000 : undefined,
          totalDistanceUnit: s.distanceM ? 'km' : undefined,
          totalEnergyBurned: s.kcal,
          totalEnergyBurnedUnit: 'kcal',
          metadata,
        });
      }
    }

    return { records, nextCursor: window.nextCursor };
  },

  normalize: normalizeAppleRecords,
};

/**
 * Folds Apple's flat sample stream into domain records.
 *
 * Named rather than inline because both routes in — the demo/API page fetch and
 * an uploaded export.xml — produce the same `HKRecord[]` and share this.
 */
function normalizeAppleRecords(records: unknown[]): NormalizedBatch {
    const sleepByNight = new Map<string, SleepInput & { _stages: Record<string, number> }>();
    const bodyByDay = new Map<string, BodyInput>();
    const workouts: WorkoutInput[] = [];

    const bodyFor = (day: string): BodyInput => {
      let b = bodyByDay.get(day);
      if (!b) {
        b = { externalId: `body-${day}`, day };
        bodyByDay.set(day, b);
      }
      return b;
    };

    for (const rec of records as HKRecord[]) {
      if (rec.kind === 'workout') {
        const modality = ACTIVITY_MAP[rec.workoutActivityType];
        if (!modality) continue;

        const startUtc = parseHkDate(rec.startDate);
        const day = startUtc.slice(0, 10);
        const durationS = rec.duration * 60; // minutes → seconds
        const distanceM = rec.totalDistance != null ? rec.totalDistance * 1000 : undefined;
        const avgHr = Number(rec.metadata.HKAverageHeartRate) || undefined;

        let sets: StrengthSetInput[] | undefined;
        if (rec.metadata.HevySetsJSON) {
          try {
            const parsed = JSON.parse(rec.metadata.HevySetsJSON) as {
              ex: string;
              n: number;
              reps: number;
              kg: number;
              rpe?: number;
            }[];
            sets = parsed.map((s) => ({
              exercise: s.ex,
              setNo: s.n,
              reps: s.reps,
              weightKg: s.kg,
              rpe: s.rpe,
            }));
          } catch {
            // A malformed third-party blob shouldn't lose the whole workout.
            sets = undefined;
          }
        }

        workouts.push({
          // HealthKit has no stable public id, so the natural key is
          // (activity, start) — which is what Apple's own dedupe uses.
          externalId: `${rec.workoutActivityType}:${rec.startDate}`,
          startUtc,
          day,
          modality,
          title: WORKOUT_TITLE[modality],
          durationS,
          distanceM,
          avgHr,
          maxHr: Number(rec.metadata.HKMaximumHeartRate) || undefined,
          kcal: rec.totalEnergyBurned,
          // Real exports carry no HKAveragePace — that metadata key is written
          // by some third-party apps and by nothing else. Derive it from the
          // distance instead, or every imported run would have a blank pace,
          // which is the one number the running charts are built on.
          paceS: rec.metadata.HKAveragePace
            ? Number(rec.metadata.HKAveragePace)
            : distanceM && distanceM > 0
              ? Math.round((durationS / (distanceM / 1000)) * 10) / 10
              : undefined,
          load: Math.round((durationS / 60) * ((avgHr ?? 120) / 130) ** 2 * 10) / 10,
          raw: rec,
          sets,
        });
        continue;
      }

      const startUtc = parseHkDate(rec.startDate);
      const day = startUtc.slice(0, 10);

      switch (rec.type) {
        case 'HKCategoryTypeIdentifierSleepAnalysis': {
          const endUtc = parseHkDate(rec.endDate);
          const night = nightKeyFor(startUtc);
          let entry = sleepByNight.get(night);
          if (!entry) {
            entry = { externalId: `sleep-${night}`, day: night, _stages: {} };
            sleepByNight.set(night, entry);
          }
          const minutes = (new Date(endUtc).getTime() - new Date(startUtc).getTime()) / 60_000;
          entry._stages[String(rec.value)] = (entry._stages[String(rec.value)] ?? 0) + minutes;
          if (!entry.bedtime || startUtc < entry.bedtime) entry.bedtime = startUtc;
          if (!entry.wakeTime || endUtc > entry.wakeTime) entry.wakeTime = endUtc;
          break;
        }
        case 'HKQuantityTypeIdentifierRestingHeartRate': {
          const night = sleepByNight.get(day);
          if (night) night.restingHr = Number(rec.value);
          break;
        }
        case 'HKQuantityTypeIdentifierRespiratoryRate': {
          const night = sleepByNight.get(day);
          if (night) night.respiratoryRate = Number(rec.value);
          break;
        }
        case 'HKQuantityTypeIdentifierBodyMass':
          bodyFor(day).weightKg = Number(rec.value);
          break;
        case 'HKQuantityTypeIdentifierBodyFatPercentage':
          // fraction → percentage
          bodyFor(day).bodyfatPct = Math.round(Number(rec.value) * 1000) / 10;
          break;
        case 'HKQuantityTypeIdentifierLeanBodyMass':
          bodyFor(day).leanMassKg = Number(rec.value);
          break;
        case 'HKQuantityTypeIdentifierVO2Max':
          bodyFor(day).vo2max = Number(rec.value);
          break;
      }
    }

    const sleep: SleepInput[] = [...sleepByNight.values()].map((entry) => {
      const s = entry._stages;
      const deep = s['HKCategoryValueSleepAnalysisAsleepDeep'] ?? 0;
      const rem = s['HKCategoryValueSleepAnalysisAsleepREM'] ?? 0;
      const light = s['HKCategoryValueSleepAnalysisAsleepCore'] ?? 0;
      const awake = s['HKCategoryValueSleepAnalysisAwake'] ?? 0;
      const asleep = deep + rem + light;
      const inBed = asleep + awake;
      const { _stages, ...rest } = entry;
      return {
        ...rest,
        totalMin: Math.round(asleep),
        deepMin: Math.round(deep),
        remMin: Math.round(rem),
        lightMin: Math.round(light),
        awakeMin: Math.round(awake),
        efficiency: inBed > 0 ? Math.round((asleep / inBed) * 1000) / 10 : undefined,
      };
    });

    // Derive lean mass where the scale reported weight and body-fat but not it.
    const body = [...bodyByDay.values()].map((b) => {
      if (b.leanMassKg == null && b.weightKg != null && b.bodyfatPct != null) {
        b.leanMassKg = Math.round(b.weightKg * (1 - b.bodyfatPct / 100) * 100) / 100;
      }
      return b;
    });

    return { workouts, sleep, body };
}

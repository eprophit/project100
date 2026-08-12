import { simDayMap } from '../sim/athlete';
import { daysInWindow, pageWindow, simulateCall } from './transport';
import {
  NotConfiguredError,
  type Connector,
  type FetchContext,
  type FetchPage,
  type NormalizedBatch,
  type WorkoutInput,
} from './types';

/**
 * Concept2 ErgData / Logbook.
 *
 * Wire quirks this connector absorbs, mirroring the real Logbook API:
 *  - `time` is in **tenths of a second**, not seconds.
 *  - `date` is a naive local timestamp with a space separator, not ISO.
 *  - splits carry `split_time` (tenths) rather than a pace.
 *  - `type` is the erg family (`rower`/`skierg`/`bike`), not the sport.
 */

const PAGE_DAYS = 60;

interface ErgResult {
  id: number;
  user_id: number;
  date: string; // "YYYY-MM-DD HH:MM:SS", naive
  type: 'rower' | 'skierg' | 'bike';
  workout_type: string;
  distance: number; // metres
  time: number; // tenths of a second
  time_formatted: string;
  spm: number;
  calories_total: number;
  heart_rate?: { average: number; max: number; ending?: number };
  stroke_rate: number;
  comments?: string;
  workout?: {
    intervals: {
      type: string;
      time: number; // tenths
      distance: number;
      calories_total: number;
      stroke_rate: number;
      heart_rate?: { average: number };
    }[];
  };
}

function formatTenths(tenths: number): string {
  const total = tenths / 10;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export const ergdata: Connector = {
  id: 'ergdata',
  name: 'ErgData (Concept2)',
  vendor: 'Concept2',
  domains: ['workouts'],
  authMode: 'oauth',
  credentialEnv: 'ERGDATA_TOKEN',
  integrationNote:
    'Live mode calls GET /api/users/me/results with a Logbook OAuth token, paging on ?from=&to=&page=.',
  backfillDays: 400,

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    if (process.env.ERGDATA_TOKEN) throw new NotConfiguredError('ergdata', 'ERGDATA_TOKEN');

    const window = pageWindow(ctx.since, ctx.cursor, PAGE_DAYS);
    await simulateCall('ergdata', window, ctx.attempt);

    const sim = simDayMap();
    const records: ErgResult[] = [];

    for (const day of daysInWindow(window)) {
      const simDay = sim.get(day);
      if (!simDay) continue;
      for (const session of simDay.sessions) {
        if (session.modality !== 'rowing') continue;
        const hh = session.startUtc.slice(11, 19);
        records.push({
          id: Number(day.replace(/-/g, '')) * 10 + 1,
          user_id: 448201,
          date: `${day} ${hh}`,
          type: 'rower',
          workout_type: session.intervals?.length ? 'FixedTimeInterval' : 'FixedTimeSplits',
          distance: session.distanceM ?? 0,
          time: Math.round(session.durationS * 10),
          time_formatted: formatTenths(Math.round(session.durationS * 10)),
          spm: Math.round(session.spm ?? 0),
          stroke_rate: Math.round(session.spm ?? 0),
          calories_total: session.kcal ?? 0,
          heart_rate: session.avgHr
            ? { average: Math.round(session.avgHr), max: Math.round(session.maxHr ?? session.avgHr) }
            : undefined,
          comments: session.title,
          workout: session.intervals?.length
            ? {
                intervals: session.intervals.map((iv) => ({
                  type: 'time',
                  time: Math.round((iv.durationS ?? 0) * 10),
                  distance: Math.round(iv.distanceM ?? 0),
                  calories_total: 0,
                  stroke_rate: Math.round(iv.spm ?? 0),
                  heart_rate: iv.avgHr ? { average: Math.round(iv.avgHr) } : undefined,
                })),
              }
            : undefined,
        });
      }
    }

    return { records, nextCursor: window.nextCursor };
  },

  normalize(records: unknown[]): NormalizedBatch {
    const workouts: WorkoutInput[] = [];

    for (const raw of records as ErgResult[]) {
      const durationS = raw.time / 10; // tenths → seconds
      const day = raw.date.slice(0, 10);
      const startUtc = `${day}T${raw.date.slice(11)}.000Z`;
      const paceS = raw.distance > 0 ? (durationS / raw.distance) * 500 : undefined;
      // Concept2's own power relation, so watts match what the monitor showed.
      const avgWatts = paceS ? 2.8 / (paceS / 500) ** 3 : undefined;
      const avgHr = raw.heart_rate?.average;

      workouts.push({
        externalId: String(raw.id),
        startUtc,
        day,
        modality: 'rowing',
        title: raw.comments ?? raw.workout_type,
        durationS,
        distanceM: raw.distance,
        avgHr,
        maxHr: raw.heart_rate?.max,
        kcal: raw.calories_total,
        avgWatts: avgWatts ? Math.round(avgWatts * 10) / 10 : undefined,
        paceS: paceS ? Math.round(paceS * 10) / 10 : undefined,
        spm: raw.stroke_rate,
        load: Math.round((durationS / 60) * ((avgHr ?? 130) / 130) ** 2 * 10) / 10,
        raw,
        intervals: raw.workout?.intervals.map((iv, i) => {
          const ivDuration = iv.time / 10;
          const ivPace = iv.distance > 0 ? (ivDuration / iv.distance) * 500 : undefined;
          return {
            label: `${i + 1} × ${formatTenths(iv.time)}`,
            durationS: ivDuration,
            distanceM: iv.distance,
            avgWatts: ivPace ? Math.round((2.8 / (ivPace / 500) ** 3) * 10) / 10 : undefined,
            avgHr: iv.heart_rate?.average,
            spm: iv.stroke_rate,
            paceS: ivPace ? Math.round(ivPace * 10) / 10 : undefined,
          };
        }),
      });
    }

    return { workouts };
  },
};

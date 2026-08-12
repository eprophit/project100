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
 * Peloton.
 *
 * Wire quirks absorbed here:
 *  - `start_time` is a Unix timestamp in **seconds**.
 *  - `total_work` is **joules**; average output has to be derived from it.
 *  - `metrics_summary.distance` is in **miles**.
 *  - the workout title lives on the nested `ride`, not the workout.
 */

const PAGE_DAYS = 60;
const MILES_TO_M = 1609.344;

interface PelotonWorkout {
  id: string;
  user_id: string;
  start_time: number; // unix seconds
  end_time: number;
  fitness_discipline: 'cycling' | 'running' | 'strength' | 'yoga';
  status: 'COMPLETE' | 'IN_PROGRESS';
  total_work: number; // joules
  ride: { id: string; title: string; duration: number; instructor_name: string };
  metrics_summary: {
    avg_output: number; // watts
    max_output: number;
    avg_cadence: number;
    avg_heart_rate?: number;
    max_heart_rate?: number;
    avg_resistance: number;
    distance: number; // MILES
    calories: number;
  };
}

const INSTRUCTORS = ['Matt Wilpers', 'Christine D’Ercole', 'Denis Morton', 'Olivia Amato'];

export const peloton: Connector = {
  id: 'peloton',
  name: 'Peloton',
  vendor: 'Peloton Interactive',
  domains: ['workouts'],
  authMode: 'token',
  credentialEnv: 'PELOTON_SESSION_ID',
  integrationNote:
    'Live mode calls GET /api/user/{id}/workouts?joins=ride&limit=&page= with a peloton_session_id cookie, then GET /api/workout/{id}/performance_graph for metrics.',
  backfillDays: 400,

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    if (process.env.PELOTON_SESSION_ID) throw new NotConfiguredError('peloton', 'PELOTON_SESSION_ID');

    const window = pageWindow(ctx.since, ctx.cursor, PAGE_DAYS);
    await simulateCall('peloton', window, ctx.attempt);

    const sim = simDayMap();
    const records: PelotonWorkout[] = [];

    for (const day of daysInWindow(window)) {
      const simDay = sim.get(day);
      if (!simDay) continue;
      for (const session of simDay.sessions) {
        if (session.modality !== 'cycling') continue;
        const start = Math.floor(new Date(session.startUtc).getTime() / 1000);
        const watts = session.avgWatts ?? 0;
        records.push({
          id: `w${day.replace(/-/g, '')}c`,
          user_id: 'u_9f21',
          start_time: start,
          end_time: start + session.durationS,
          fitness_discipline: 'cycling',
          status: 'COMPLETE',
          total_work: Math.round(watts * session.durationS),
          ride: {
            id: `r${day.replace(/-/g, '')}`,
            title: session.title,
            duration: session.durationS,
            instructor_name: INSTRUCTORS[start % INSTRUCTORS.length],
          },
          metrics_summary: {
            avg_output: Math.round(watts),
            max_output: Math.round(watts * 1.55),
            avg_cadence: Math.round(session.spm ?? 88),
            avg_heart_rate: session.avgHr ? Math.round(session.avgHr) : undefined,
            max_heart_rate: session.maxHr ? Math.round(session.maxHr) : undefined,
            avg_resistance: 42,
            distance: Math.round(((session.distanceM ?? 0) / MILES_TO_M) * 100) / 100,
            calories: session.kcal ?? 0,
          },
        });
      }
    }

    return { records, nextCursor: window.nextCursor };
  },

  normalize(records: unknown[]): NormalizedBatch {
    const workouts: WorkoutInput[] = [];

    for (const raw of records as PelotonWorkout[]) {
      if (raw.status !== 'COMPLETE') continue; // in-progress rides re-sync later

      const startUtc = new Date(raw.start_time * 1000).toISOString();
      const day = startUtc.slice(0, 10);
      const durationS = raw.end_time - raw.start_time;
      const m = raw.metrics_summary;
      // Derive average power from total work rather than trusting avg_output,
      // which Peloton rounds aggressively on short rides.
      const avgWatts = durationS > 0 ? raw.total_work / durationS : m.avg_output;

      workouts.push({
        externalId: raw.id,
        startUtc,
        day,
        modality: 'cycling',
        title: `${raw.ride.title} · ${raw.ride.instructor_name}`,
        durationS,
        distanceM: Math.round(m.distance * MILES_TO_M),
        avgHr: m.avg_heart_rate,
        maxHr: m.max_heart_rate,
        kcal: m.calories,
        avgWatts: Math.round(avgWatts * 10) / 10,
        normWatts: Math.round(avgWatts * 1.04 * 10) / 10,
        spm: m.avg_cadence,
        load: Math.round((durationS / 60) * ((m.avg_heart_rate ?? 130) / 130) ** 2 * 10) / 10,
        raw,
      });
    }

    return { workouts };
  },
};

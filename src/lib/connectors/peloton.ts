import { simDayMap } from '../sim/athlete';
import { apiFetch, daysInWindow, pageWindow, simulateCall } from './transport';
import {
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

const DISCIPLINE_MAP: Record<string, WorkoutInput['modality'] | undefined> = {
  cycling: 'cycling',
  running: 'running',
  walking: 'walking',
  strength: 'strength',
  yoga: 'mobility',
  stretching: 'mobility',
  meditation: undefined, // real, but not training — it would distort load
};

// ---------------------------------------------------------------------------
// Live: Peloton's private web API
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.onepeloton.com';
const PER_PAGE = 30;
/** Metric fetches per batch. Their API is unpublished; do not hammer it. */
const METRIC_CONCURRENCY = 4;

interface LiveCursor {
  userId: string;
  page: number;
  /** Stop paging once we reach rows older than the watermark. */
  since: string;
}

interface WorkoutListResponse {
  data: Partial<PelotonWorkout>[];
  page_count?: number;
  page?: number;
}

interface PerformanceGraph {
  duration?: number;
  summaries?: { slug: string; value: number | null }[];
  average_summaries?: { slug: string; value: number | null }[];
  metrics?: { slug: string; average_value?: number | null; max_value?: number | null }[];
}

/**
 * Pages the workout list, then fills in metrics one workout at a time.
 *
 * The N+1 is theirs, not ours: the list endpoint returns no distance, calories
 * or heart rate, and there is no bulk metrics endpoint. It is bounded by
 * stopping as soon as a page runs past the watermark, so a routine incremental
 * sync costs a handful of calls even though a first backfill costs one per
 * workout.
 */
async function fetchLive(session: string, ctx: FetchContext): Promise<FetchPage> {
  const headers = { Cookie: `peloton_session_id=${session}` };
  const authHint = 'PELOTON_SESSION_ID is missing or the session has expired — log in again and copy a fresh cookie.';

  const state: LiveCursor = ctx.cursor
    ? (JSON.parse(ctx.cursor) as LiveCursor)
    : { userId: await resolveUserId(headers, authHint), page: 0, since: ctx.since };

  const list = (await apiFetch(
    'peloton',
    `${API_BASE}/api/user/${state.userId}/workouts?joins=ride&limit=${PER_PAGE}&page=${state.page}&sort_by=-created`,
    { headers, authHint },
  )) as WorkoutListResponse;

  const rows = Array.isArray(list.data) ? list.data : [];
  // Results come newest-first, so the watermark is a stopping condition rather
  // than a filter — everything past the first old row is older still.
  const fresh: Partial<PelotonWorkout>[] = [];
  let reachedWatermark = false;
  for (const w of rows) {
    const day = w.start_time ? new Date(w.start_time * 1000).toISOString().slice(0, 10) : null;
    if (day && day < state.since) {
      reachedWatermark = true;
      break;
    }
    fresh.push(w);
  }

  const records = await withMetrics(fresh, headers, authHint);

  const morePages = list.page_count != null ? state.page + 1 < list.page_count : rows.length === PER_PAGE;
  return {
    records,
    nextCursor:
      reachedWatermark || !morePages
        ? null
        : JSON.stringify({ ...state, page: state.page + 1 } satisfies LiveCursor),
  };
}

async function resolveUserId(headers: Record<string, string>, authHint: string): Promise<string> {
  const me = (await apiFetch('peloton', `${API_BASE}/api/me`, { headers, authHint })) as { id?: string };
  if (!me.id) throw new Error('peloton: /api/me returned no user id.');
  return me.id;
}

/** Attaches a metrics_summary to each workout, so `normalize` is unchanged. */
async function withMetrics(
  workouts: Partial<PelotonWorkout>[],
  headers: Record<string, string>,
  authHint: string,
): Promise<PelotonWorkout[]> {
  const out: PelotonWorkout[] = [];

  for (let i = 0; i < workouts.length; i += METRIC_CONCURRENCY) {
    const slice = workouts.slice(i, i + METRIC_CONCURRENCY);
    const filled = await Promise.all(
      slice.map(async (w) => {
        if (!w.id) return null;
        let graph: PerformanceGraph = {};
        try {
          graph = (await apiFetch(
            'peloton',
            `${API_BASE}/api/workout/${w.id}/performance_graph?every_n=60`,
            { headers, authHint },
          )) as PerformanceGraph;
        } catch {
          // One unreadable ride shouldn't abort a backfill; it lands with the
          // fields the list endpoint did give us and refreshes on a later sync.
        }
        return merge(w, graph);
      }),
    );
    for (const f of filled) if (f) out.push(f);
  }

  return out;
}

function merge(w: Partial<PelotonWorkout>, graph: PerformanceGraph): PelotonWorkout {
  const summary = (slug: string): number =>
    Number(graph.summaries?.find((s) => s.slug === slug)?.value ?? 0);
  const metric = (slug: string, key: 'average_value' | 'max_value'): number | undefined => {
    const found = graph.metrics?.find((m) => m.slug === slug)?.[key];
    return found == null ? undefined : Number(found);
  };

  const start = w.start_time ?? 0;
  const end = w.end_time ?? start + (graph.duration ?? 0);

  return {
    id: String(w.id),
    user_id: String(w.user_id ?? ''),
    start_time: start,
    end_time: end,
    fitness_discipline: (w.fitness_discipline ?? 'cycling') as PelotonWorkout['fitness_discipline'],
    status: (w.status ?? 'COMPLETE') as PelotonWorkout['status'],
    // total_work is joules and is on the list row; the graph reports total
    // output in kilojoules, so it is only a fallback and needs scaling.
    total_work: w.total_work ?? summary('total_output') * 1000,
    ride: {
      id: String(w.ride?.id ?? ''),
      title: w.ride?.title ?? 'Peloton workout',
      duration: w.ride?.duration ?? graph.duration ?? end - start,
      instructor_name: w.ride?.instructor_name ?? '',
    },
    metrics_summary: {
      avg_output: metric('output', 'average_value') ?? 0,
      max_output: metric('output', 'max_value') ?? 0,
      avg_cadence: metric('cadence', 'average_value') ?? 0,
      avg_heart_rate: metric('heart_rate', 'average_value'),
      max_heart_rate: metric('heart_rate', 'max_value'),
      avg_resistance: metric('resistance', 'average_value') ?? 0,
      distance: summary('distance'), // miles, as the demo path also assumes
      calories: summary('calories'),
    },
  };
}

export const peloton: Connector = {
  id: 'peloton',
  name: 'Peloton',
  vendor: 'Peloton Interactive',
  domains: ['workouts'],
  authMode: 'token',
  credentialEnv: 'PELOTON_SESSION_ID',
  liveVia: 'api',
  integrationNote:
    'Peloton publishes no official API. Live mode uses the same private endpoints their web app calls — GET /api/user/{id}/workouts?joins=ride, then /api/workout/{id}/performance_graph — authenticated with a peloton_session_id cookie. Undocumented and unsupported: it can change without notice.',
  backfillDays: 400,

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    const session = process.env.PELOTON_SESSION_ID;
    if (session) return fetchLive(session, ctx);

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

      // A real Peloton account is not only bikes — tread runs, strength and
      // yoga classes all come back from the same endpoint.
      const modality = DISCIPLINE_MAP[raw.fitness_discipline];
      if (!modality) continue;

      workouts.push({
        externalId: raw.id,
        startUtc,
        day,
        modality,
        title: [raw.ride.title, raw.ride.instructor_name].filter(Boolean).join(' · '),
        durationS,
        distanceM: Math.round(m.distance * MILES_TO_M),
        avgHr: m.avg_heart_rate,
        maxHr: m.max_heart_rate,
        kcal: m.calories,
        // Output is a bike concept; a tread class reports none, and writing a
        // zero there would drag the power charts down with fake data points.
        avgWatts: modality === 'cycling' && avgWatts > 0 ? Math.round(avgWatts * 10) / 10 : undefined,
        normWatts: modality === 'cycling' && avgWatts > 0 ? Math.round(avgWatts * 1.04 * 10) / 10 : undefined,
        spm: m.avg_cadence || undefined,
        load: Math.round((durationS / 60) * ((m.avg_heart_rate ?? 130) / 130) ** 2 * 10) / 10,
        raw,
      });
    }

    return { workouts };
  },
};

import { today } from '../dates';
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

// ---------------------------------------------------------------------------
// Live: Concept2 Logbook API
// ---------------------------------------------------------------------------

const API_BASE = 'https://log.concept2.com/api';
const PER_PAGE = 50;

/** Live cursor: the date window is fixed for the pass, the page number walks. */
interface LiveCursor {
  from: string;
  to: string;
  page: number;
}

interface LogbookResponse {
  data: ErgResult[];
  meta?: { pagination?: { current_page: number; total_pages: number } };
}

/**
 * Pages the Logbook results endpoint.
 *
 * Unlike the demo transport, which walks a fixed number of days per page, this
 * fixes the window for the whole pass and walks the API's own pagination — the
 * upstream decides how much fits in a page, and asking it to re-slice by date
 * would just make more round trips for the same rows.
 */
async function fetchLive(token: string, ctx: FetchContext): Promise<FetchPage> {
  const state: LiveCursor = ctx.cursor
    ? (JSON.parse(ctx.cursor) as LiveCursor)
    : { from: ctx.since, to: today(), page: 1 };

  const url =
    `${API_BASE}/users/me/results` +
    `?from=${state.from}&to=${state.to}&number=${PER_PAGE}&page=${state.page}`;

  const body = (await apiFetch('ergdata', url, {
    headers: { Authorization: `Bearer ${token}` },
    authHint: 'ERGDATA_TOKEN is missing, expired, or lacks the results:read scope.',
  })) as LogbookResponse;

  const records = Array.isArray(body.data) ? body.data : [];
  const pagination = body.meta?.pagination;
  const hasMore = pagination
    ? pagination.current_page < pagination.total_pages
    : records.length === PER_PAGE; // no meta: keep going while pages come back full

  return {
    records,
    nextCursor: hasMore
      ? JSON.stringify({ ...state, page: state.page + 1 } satisfies LiveCursor)
      : null,
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
  liveVia: 'api',
  integrationNote:
    'Live mode calls GET https://log.concept2.com/api/users/me/results with a Logbook OAuth bearer token, paging on ?from=&to=&page=. Set ERGDATA_TOKEN to a token with the results:read scope.',
  backfillDays: 400,

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    const token = process.env.ERGDATA_TOKEN;
    if (token) return fetchLive(token, ctx);

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
      // `type` is the erg family, not the sport. A real logbook mixes them, so
      // the demo's "everything is rowing" assumption does not survive live data.
      // The SkiErg has no separate modality here and is closest to rowing in
      // both movement pattern and how its load should count.
      const modality = raw.type === 'bike' ? 'cycling' : 'rowing';
      // Concept2's own power relation, so watts match what the monitor showed.
      // It is calibrated for the rower and SkiErg; the BikeErg reports its own.
      const avgWatts = paceS && modality === 'rowing' ? 2.8 / (paceS / 500) ** 3 : undefined;
      const avgHr = raw.heart_rate?.average;

      workouts.push({
        externalId: String(raw.id),
        startUtc,
        day,
        modality,
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

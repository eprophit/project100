import { addDays, diffDays, today, type DayKey } from '../dates';
import { historyStart } from '../sim/athlete';
import { TransientUpstreamError } from './types';

/**
 * Shared transport behaviour for demo-mode connectors.
 *
 * The point of this file is that the *engine* above it is real. Demo connectors
 * paginate, hand back opaque cursors, occasionally rate-limit, and occasionally
 * fail transiently — so retry/backoff, cursor persistence, partial-run handling
 * and dedupe all get exercised on every sync. Replacing this with `fetch()`
 * against the vendor changes nothing upstream of it.
 */

export interface Window {
  from: DayKey;
  to: DayKey;
  nextCursor: string | null;
}

interface CursorState {
  /** Last day already emitted in this pagination pass. */
  at: DayKey;
}

function parseCursor(cursor: string | null): CursorState | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as CursorState;
    if (typeof parsed.at === 'string') return parsed;
  } catch {
    /* fall through — treat malformed cursors as "start over" */
  }
  return null;
}

/**
 * Computes the day window this page should cover.
 *
 * `since` is the source's persisted watermark. The first page of a pass starts
 * there (inclusive) so late-arriving edits to the boundary day are re-fetched;
 * the engine's upsert makes that idempotent.
 */
export function pageWindow(since: DayKey, cursor: string | null, pageDays: number): Window {
  const end = today();
  const state = parseCursor(cursor);
  const from = state ? addDays(state.at, 1) : clampToHistory(since);

  if (from > end) return { from, to: end, nextCursor: null };

  const to = addDays(from, pageDays - 1) > end ? end : addDays(from, pageDays - 1);
  const nextCursor = to >= end ? null : JSON.stringify({ at: to } satisfies CursorState);
  return { from, to, nextCursor };
}

function clampToHistory(day: DayKey): DayKey {
  const start = historyStart();
  return day < start ? start : day;
}

export function daysInWindow(w: Window): DayKey[] {
  const out: DayKey[] = [];
  if (w.from > w.to) return out;
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Models the upstream's failure surface deterministically: a given
 * (source, window, attempt) either succeeds or fails the same way every run, so
 * the retry path is reproducible rather than flaky-in-testing.
 */
export async function simulateCall(sourceId: string, window: Window, attempt: number): Promise<void> {
  const seed = hashString(`${sourceId}:${window.from}:${window.to}`);

  // First attempts fail ~8% of the time; retries always succeed, so a run
  // recovers rather than dying — which is the behaviour worth demonstrating.
  if (attempt === 1) {
    const roll = seed % 100;
    if (roll < 4) {
      throw new TransientUpstreamError(`${sourceId}: upstream returned 429 (rate limited)`, 300);
    }
    if (roll < 8) {
      throw new TransientUpstreamError(`${sourceId}: upstream returned 503`, 200);
    }
  }

  // A little latency so progress in the UI is legible and concurrent syncs
  // interleave the way they would against a real API.
  await sleep(12 + (seed % 25));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Default watermark for a source that has never synced. */
export function initialSince(backfillDays: number): DayKey {
  const wanted = addDays(today(), -(backfillDays - 1));
  const start = historyStart();
  return wanted < start ? start : wanted;
}

export function isFuture(day: DayKey): boolean {
  return diffDays(today(), day) > 0;
}

/**
 * Day keys are `YYYY-MM-DD` strings computed in UTC. Every table keys on them,
 * so charts, joins and rollups line up without timezone drift between the
 * server render and the client.
 */

export type DayKey = string;

export function toDay(input: Date | string): DayKey {
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toISOString().slice(0, 10);
}

export function today(): DayKey {
  return toDay(new Date());
}

export function addDays(day: DayKey, n: number): DayKey {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
}

export function diffDays(a: DayKey, b: DayKey): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** Inclusive range, ascending. */
export function dayRange(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysAgo(n: number, from: DayKey = today()): DayKey {
  return addDays(from, -n);
}

/** Index 0 = Monday, matching `weekStart`. */
export const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function weekStart(day: DayKey): DayKey {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
}

export function formatDay(day: DayKey, opts: { year?: boolean } = {}): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: opts.year ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Seconds-per-unit → `m:ss` pace label. */
export function formatPace(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

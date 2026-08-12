import { simDayMap } from '../sim/athlete';
import { daysInWindow, pageWindow, simulateCall } from './transport';
import {
  NotConfiguredError,
  type Connector,
  type FetchContext,
  type FetchPage,
  type NormalizedBatch,
  type RecoveryInput,
} from './types';

/**
 * HRV4Training.
 *
 * The odd one out: its export is **CSV**, not JSON, so this connector's
 * `fetchPage` returns raw text lines and `normalize` does the parsing. That is
 * on purpose — the engine's contract is "records in, normalised batch out", and
 * it shouldn't care that one provider ships text.
 */

const PAGE_DAYS = 120;

const CSV_HEADER = 'date,rMSSD,lnRMSSD,HR,recovery_points,training_load,tags,note';

export const hrv4training: Connector = {
  id: 'hrv4training',
  name: 'HRV4Training',
  vendor: 'HRV4Training',
  domains: ['recovery'],
  authMode: 'token',
  credentialEnv: 'HRV4TRAINING_TOKEN',
  integrationNote:
    'Live mode pulls the CSV export from the HRV4Training API (or a scheduled email/Dropbox drop) and parses the same columns.',
  backfillDays: 400,

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    if (process.env.HRV4TRAINING_TOKEN) throw new NotConfiguredError('hrv4training', 'HRV4TRAINING_TOKEN');

    const window = pageWindow(ctx.since, ctx.cursor, PAGE_DAYS);
    await simulateCall('hrv4training', window, ctx.attempt);

    const sim = simDayMap();
    const lines: string[] = [CSV_HEADER];

    for (const day of daysInWindow(window)) {
      const d = sim.get(day);
      if (!d) continue;
      const tags: string[] = [];
      if (d.sessions.some((s) => (s.rpe ?? 0) >= 8)) tags.push('hard_session');
      if (d.sleep.totalMin < 400) tags.push('poor_sleep');
      if (d.protocols.some((p) => p.kind === 'sauna')) tags.push('sauna');
      if (d.protocols.some((p) => p.kind === 'cold_plunge')) tags.push('cold_exposure');

      lines.push(
        [
          day,
          d.recovery.rmssd.toFixed(1),
          d.recovery.ln.toFixed(2),
          d.recovery.restingHr.toFixed(0),
          String(d.recovery.readiness),
          d.acuteLoad.toFixed(0),
          tags.join(';'),
          d.recovery.note,
        ].join(','),
      );
    }

    // One "record" per line keeps the engine's counters meaningful.
    return { records: lines, nextCursor: window.nextCursor };
  },

  normalize(records: unknown[]): NormalizedBatch {
    const recovery: RecoveryInput[] = [];
    const lines = records as string[];

    let columns: string[] | null = null;
    for (const line of lines) {
      if (!line || typeof line !== 'string') continue;
      if (line.startsWith('date,')) {
        columns = line.split(',');
        continue;
      }
      if (!columns) columns = CSV_HEADER.split(',');

      const cells = line.split(',');
      const row: Record<string, string> = {};
      columns.forEach((c, i) => (row[c] = cells[i] ?? ''));

      const day = row.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue; // skip anything malformed

      const rmssd = Number(row.rMSSD);
      if (!Number.isFinite(rmssd)) continue;

      recovery.push({
        externalId: `hrv-${day}`,
        day,
        hrvRmssd: rmssd,
        hrvLn: Number(row.lnRMSSD) || Math.round(Math.log(rmssd) * 100) / 100,
        restingHr: Number(row.HR) || undefined,
        readiness: Number(row.recovery_points) || undefined,
        note: [row.note, row.tags ? `tags: ${row.tags.replace(/;/g, ', ')}` : '']
          .filter(Boolean)
          .join(' · '),
        raw: row,
      });
    }

    return { recovery };
  },
};

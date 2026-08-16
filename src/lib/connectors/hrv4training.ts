import { CsvTable, parseCsv, parseDayKey } from '../imports/csv';
import { simDayMap } from '../sim/athlete';
import { daysInWindow, pageWindow, simulateCall } from './transport';
import {
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
  liveVia: 'file_import',
  integrationNote:
    'HRV4Training exports CSV rather than exposing a per-user API. Upload the export here, or point HRV4TRAINING_TOKEN at a folder (a Dropbox sync target works) and drops are ingested on the next sync.',
  backfillDays: 400,

  fileImport: {
    instructions:
      'In HRV4Training: Settings → Export data → email yourself the CSV. Upload it here; re-importing a longer export later updates the overlap rather than duplicating it.',
    accept: ['.csv'],
    matches(file) {
      if (!/\.csv$/i.test(file.filename)) return false;
      const head = file.head.toLowerCase();
      return head.includes('rmssd') || head.includes('hrv4training');
    },
    async parse(file) {
      return { recovery: parseExportCsv(await file.text()) };
    },
  },

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
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

/**
 * Parses a real HRV4Training CSV export.
 *
 * Kept separate from `normalize()` above, which reads the narrow fixed schema
 * the demo transport emits. The shipping export is much wider and its column
 * names have moved between app versions, so this matches them loosely and takes
 * whatever it recognises.
 */
export function parseExportCsv(text: string): RecoveryInput[] {
  const table = new CsvTable(parseCsv(text));
  const out: RecoveryInput[] = [];

  for (const row of table.rows) {
    const day = parseDayKey(table.cell(row, 'date', 'day', 'timestamp'));
    if (!day) continue;

    const rmssd = table.num(row, 'rmssd', 'rmssdvalue', 'hrv');
    const ln = table.num(row, 'lnrmssd', 'lnrmssdvalue');
    // A row with neither is a day the user opened the app but did not measure.
    if (rmssd == null && ln == null) continue;

    const resolvedRmssd = rmssd ?? Math.round(Math.exp(ln as number) * 10) / 10;
    const tags = table.cell(row, 'tags', 'tag');
    const note = table.cell(row, 'note', 'notes', 'comment');

    out.push({
      externalId: `hrv-${day}`,
      day,
      hrvRmssd: resolvedRmssd,
      hrvLn: ln ?? Math.round(Math.log(resolvedRmssd) * 100) / 100,
      restingHr: table.num(row, 'hr', 'heartrate', 'restinghr'),
      readiness: table.num(row, 'recoverypoints', 'readiness', 'recovery'),
      note: [note, tags ? `tags: ${tags.replace(/;/g, ', ')}` : ''].filter(Boolean).join(' \u00b7 '),
    });
  }

  return out;
}

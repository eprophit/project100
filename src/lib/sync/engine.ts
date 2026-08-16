import { getDb, one, run } from '../db';
import { today, type DayKey } from '../dates';
import { CONNECTORS, connectorMode, ensureSourcesRegistered, getConnector } from '../connectors/registry';
import { drainDirectory } from '../imports/importer';
import { initialSince, sleep } from '../connectors/transport';
import {
  NotConfiguredError,
  TransientUpstreamError,
  type Connector,
} from '../connectors/types';
import { applyBatch, type Counters } from './apply';
import type { SourceRow } from '../types';

/**
 * Batch ingestion.
 *
 * One pass per source: page until the cursor is exhausted, normalise each page,
 * upsert it inside a transaction, and advance the source's watermark to the
 * newest day actually observed. Every write is keyed on
 * `(source_id, external_id)` so re-running a sync is a no-op — which matters,
 * because the first page of every pass deliberately re-fetches the boundary day
 * to pick up late edits.
 */

const MAX_PAGES = 40;
const MAX_ATTEMPTS = 3;

export interface SyncResult {
  sourceId: string;
  status: 'ok' | 'partial' | 'error';
  pages: number;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  retries: number;
  error?: string;
  durationMs: number;
}

export async function syncSource(sourceId: string): Promise<SyncResult> {
  ensureSourcesRegistered();

  const connector = getConnector(sourceId);
  if (!connector) throw new Error(`Unknown source: ${sourceId}`);

  const source = one<SourceRow>('SELECT * FROM sources WHERE id = ?', [sourceId]);
  if (!source) throw new Error(`Source not registered: ${sourceId}`);

  // A source whose vendor has no API doesn't page anything — its "upstream" is
  // a folder of exported files. Same audit trail, same upsert, different door.
  if (connector.liveVia === 'file_import' && connectorMode(connector) === 'live') {
    return syncFromDirectory(connector, process.env[connector.credentialEnv] as string);
  }

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  getDb()
    .prepare('INSERT INTO sync_runs (source_id, started_at, status) VALUES (?, ?, ?)')
    .run(sourceId, startedAt, 'running');
  const runId = (one<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0) as number;

  const counters: Counters = { inserted: 0, updated: 0, skipped: 0 };
  let pages = 0;
  let fetched = 0;
  let retries = 0;
  let maxDay: DayKey | null = null;
  let error: string | undefined;
  let status: SyncResult['status'] = 'ok';

  const since = source.cursor ?? initialSince(connector.backfillDays);
  let cursor: string | null = null;

  try {
    while (pages < MAX_PAGES) {
      const page = await fetchWithRetry(connector, { since, cursor }, (n) => {
        retries += n;
      });

      pages += 1;
      fetched += page.records.length;

      if (page.records.length > 0) {
        const batch = connector.normalize(page.records);
        const observed = applyBatch(sourceId, batch, counters);
        if (observed && (!maxDay || observed > maxDay)) maxDay = observed;
      }

      cursor = page.nextCursor;
      if (!cursor) break;
    }

    if (pages >= MAX_PAGES && cursor) {
      status = 'partial';
      error = `Stopped after ${MAX_PAGES} pages with more data available; the next sync resumes from the watermark.`;
    }
  } catch (err) {
    status = 'error';
    error = err instanceof Error ? err.message : String(err);
    // Rows already committed in earlier pages stay — the watermark below is
    // what makes resuming safe.
    if (counters.inserted + counters.updated > 0) status = 'partial';
  }

  // Advance only to what we actually saw. A source that returned nothing keeps
  // its old watermark rather than silently skipping a gap.
  const watermark = maxDay ?? source.cursor ?? null;
  const finishedAt = new Date().toISOString();

  run(
    `UPDATE sync_runs SET finished_at = ?, status = ?, pages = ?, fetched = ?,
       inserted = ?, updated = ?, skipped = ?, retries = ?, error = ?
     WHERE id = ?`,
    [
      finishedAt,
      status,
      pages,
      fetched,
      counters.inserted,
      counters.updated,
      counters.skipped,
      retries,
      error ?? null,
      runId,
    ],
  );

  run('UPDATE sources SET cursor = ?, last_sync_at = ?, last_status = ?, last_error = ? WHERE id = ?', [
    watermark,
    finishedAt,
    status,
    error ?? null,
    sourceId,
  ]);

  return {
    sourceId,
    status,
    pages,
    fetched,
    inserted: counters.inserted,
    updated: counters.updated,
    skipped: counters.skipped,
    retries,
    error,
    durationMs: Date.now() - t0,
  };
}

/**
 * Live sync for a file-backed source: drain its watched directory.
 *
 * Reported as a normal sync run so the Connections page tells one story
 * regardless of how a source gets its data — `pages` counts files rather than
 * HTTP pages, which is the honest analogue.
 */
async function syncFromDirectory(connector: Connector, dir: string): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  getDb()
    .prepare('INSERT INTO sync_runs (source_id, started_at, status) VALUES (?, ?, ?)')
    .run(connector.id, startedAt, 'running');
  const runId = (one<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0) as number;

  let status: SyncResult['status'] = 'ok';
  let error: string | undefined;
  const totals: Counters = { inserted: 0, updated: 0, skipped: 0 };
  let files = 0;
  let fetched = 0;

  try {
    const outcomes = await drainDirectory(dir, connector.id);
    for (const o of outcomes) {
      files += 1;
      fetched += o.records;
      totals.inserted += o.inserted;
      totals.updated += o.updated;
      totals.skipped += o.skipped;
      if (o.status === 'error') {
        status = 'partial';
        error = o.error;
      }
    }
    if (!files) {
      error = `No new files in ${dir}. Drop an export there and sync again.`;
    }
  } catch (err) {
    status = 'error';
    error = err instanceof Error ? err.message : String(err);
  }

  const finishedAt = new Date().toISOString();
  run(
    `UPDATE sync_runs SET finished_at = ?, status = ?, pages = ?, fetched = ?,
       inserted = ?, updated = ?, skipped = ?, retries = 0, error = ?
     WHERE id = ?`,
    [finishedAt, status, files, fetched, totals.inserted, totals.updated, totals.skipped, error ?? null, runId],
  );
  // The watermark is advanced per file by the importer, so it is deliberately
  // not touched here — an import of old history must not rewind it.
  run('UPDATE sources SET last_sync_at = ?, last_status = ?, last_error = ? WHERE id = ?', [
    finishedAt, status, error ?? null, connector.id,
  ]);

  return {
    sourceId: connector.id,
    status,
    pages: files,
    fetched,
    inserted: totals.inserted,
    updated: totals.updated,
    skipped: totals.skipped,
    retries: 0,
    error,
    durationMs: Date.now() - t0,
  };
}

async function fetchWithRetry(
  connector: Connector,
  args: { since: DayKey; cursor: string | null },
  onRetry: (n: number) => void,
) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await connector.fetchPage({ since: args.since, cursor: args.cursor, attempt });
    } catch (err) {
      lastErr = err;
      // Configuration problems are permanent — retrying just delays the report.
      if (err instanceof NotConfiguredError) throw err;
      if (!(err instanceof TransientUpstreamError) || attempt === MAX_ATTEMPTS) throw err;
      onRetry(1);
      await sleep(err.retryAfterMs * attempt); // linear backoff
    }
  }
  throw lastErr;
}

/** Runs every enabled source. Failures are isolated per source. */
export async function syncAll(): Promise<SyncResult[]> {
  ensureSourcesRegistered();
  const results: SyncResult[] = [];
  for (const c of CONNECTORS) {
    const src = one<SourceRow>('SELECT enabled FROM sources WHERE id = ?', [c.id]);
    if (src && src.enabled === 0) continue;
    try {
      results.push(await syncSource(c.id));
    } catch (err) {
      results.push({
        sourceId: c.id,
        status: 'error',
        pages: 0,
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        retries: 0,
        error: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      });
    }
  }
  return results;
}

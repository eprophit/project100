import { CONNECTORS, ensureSourcesRegistered, getConnector } from '../connectors/registry';
import { one, run } from '../db';
import type { Connector, ImportFile, NormalizedBatch } from '../connectors/types';
import { applyBatch, type Counters } from '../sync/apply';
import {
  describeFile,
  findImportByHash,
  findImportByPath,
  hashFile,
  importDir,
  recordImport,
  scanDirectory,
  stageBuffer,
  type ImportRow,
} from './store';

/**
 * File ingestion.
 *
 * Four of the six vendors publish no usable API, so the realistic way to get
 * real data out of them is the export file they will give you. This is that
 * path — and it deliberately ends in exactly the same `applyBatch` the API
 * connectors use, so an imported row and a fetched row are the same row.
 *
 * Two things fall out of that which are worth stating plainly:
 *
 *  - **Re-importing is safe.** Every record carries a `(source_id, external_id)`
 *    key, so a longer export that overlaps a shorter one updates the overlap
 *    instead of duplicating it. You never have to work out "which dates do I
 *    already have" before exporting.
 *  - **Sources can be mixed.** Importing an Apple Health export does not
 *    disturb rows that came from Concept2, because they are different sources.
 */

export interface ImportOutcome {
  sourceId: string | null;
  filename: string;
  status: 'ok' | 'error' | 'duplicate' | 'unrecognised';
  records: number;
  inserted: number;
  updated: number;
  skipped: number;
  firstDay: string | null;
  lastDay: string | null;
  error?: string;
  row?: ImportRow;
}

/** Which connector claims this file, if any. */
export function detectSource(file: ImportFile): Connector | null {
  for (const c of CONNECTORS) {
    if (c.fileImport?.matches(file)) return c;
  }
  return null;
}

/** Connectors that accept an export, for the upload UI. */
export function importableConnectors() {
  return CONNECTORS.filter((c) => c.fileImport).map((c) => ({
    id: c.id,
    name: c.name,
    vendor: c.vendor,
    domains: c.domains,
    accept: c.fileImport!.accept,
    instructions: c.fileImport!.instructions,
  }));
}

/** Stages an uploaded buffer, then imports it. */
export async function importUpload(
  filename: string,
  bytes: Buffer,
  forcedSourceId?: string,
): Promise<ImportOutcome> {
  const file = await stageBuffer(filename, bytes);
  return importStagedFile(file, forcedSourceId);
}

/** Imports a file already on disk (an upload, or one found in a watched dir). */
export async function importStagedFile(
  file: ImportFile,
  forcedSourceId?: string,
): Promise<ImportOutcome> {
  ensureSourcesRegistered();

  const base: ImportOutcome = {
    sourceId: forcedSourceId ?? null,
    filename: file.filename,
    status: 'ok',
    records: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    firstDay: null,
    lastDay: null,
  };

  // Hash before parsing: an identical file is the common case when someone
  // re-uploads rather than re-exports, and re-parsing a 400 MB XML to discover
  // we already have it would be a slow way to learn nothing.
  const sha256 = await hashFile(file.path);
  const already = findImportByHash(sha256);
  if (already) {
    return {
      ...base,
      sourceId: already.source_id,
      status: 'duplicate',
      records: already.records,
      firstDay: already.first_day,
      lastDay: already.last_day,
      row: already,
      error: `Already imported on ${already.imported_at.slice(0, 10)}.`,
    };
  }

  const connector = forcedSourceId ? getConnector(forcedSourceId) : detectSource(file);
  if (!connector?.fileImport) {
    return {
      ...base,
      status: 'unrecognised',
      error: forcedSourceId
        ? `${forcedSourceId} does not accept file imports.`
        : `Could not tell which source ${file.filename} came from. Pick one explicitly and try again.`,
    };
  }

  const counters: Counters = { inserted: 0, updated: 0, skipped: 0 };
  let batch: NormalizedBatch;
  try {
    batch = await connector.fileImport.parse(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const row = recordImport({
      source_id: connector.id,
      filename: file.filename,
      stored_path: file.path,
      bytes: file.size,
      sha256,
      imported_at: new Date().toISOString(),
      status: 'error',
      records: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      first_day: null,
      last_day: null,
      error: message,
    });
    return { ...base, sourceId: connector.id, status: 'error', error: message, row };
  }

  const { count, first, last } = describeBatch(batch);
  applyBatch(connector.id, batch, counters);

  const row = recordImport({
    source_id: connector.id,
    filename: file.filename,
    stored_path: file.path,
    bytes: file.size,
    sha256,
    imported_at: new Date().toISOString(),
    // A file that parsed cleanly but yielded nothing is not a success. It is
    // almost always the wrong export type, and reporting it as OK sends the
    // user looking for the problem everywhere except where it is.
    status: count > 0 ? 'ok' : 'empty',
    records: count,
    inserted: counters.inserted,
    updated: counters.updated,
    skipped: counters.skipped,
    first_day: first,
    last_day: last,
    error:
      count === 0
        ? `Parsed cleanly but held nothing ${connector.name} contributes. Check you exported the right data type.`
        : null,
  });

  // An import extends coverage backwards as often as forwards, so the source's
  // watermark is only pushed when the file genuinely contains newer data.
  advanceWatermark(connector.id, last);

  return {
    ...base,
    sourceId: connector.id,
    records: count,
    inserted: counters.inserted,
    updated: counters.updated,
    skipped: counters.skipped,
    firstDay: first,
    lastDay: last,
    row,
  };
}

/**
 * Imports everything in a directory that has not been seen before.
 *
 * This is what a file-backed source does in live mode: its credential env var
 * names a folder, and every export dropped there is picked up on the next sync.
 * Point it at a Dropbox or iCloud folder and the "integration" is the vendor's
 * own scheduled export.
 */
export async function drainDirectory(dir: string, onlySourceId?: string): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];

  for (const full of await scanDirectory(dir)) {
    // Already drained on a previous pass. Checked by path before hashing,
    // because hashing is a full read and an Apple export is hundreds of MB —
    // re-hashing it on every sync would make syncing quietly expensive.
    if (findImportByPath(full)) continue;

    const file = await describeFile(full);

    // Detect the source rather than forcing it. One folder is the drop target
    // for every connector at once, so `onlySourceId` filters — it must not
    // claim a lab CSV as an HRV export, which would consume that file's hash
    // and stop the right connector from ever seeing it.
    const detected = detectSource(file);
    if (!detected) continue;
    if (onlySourceId && detected.id !== onlySourceId) continue;

    const outcome = await importStagedFile(file);
    if (outcome.status === 'duplicate') continue;
    outcomes.push(outcome);
  }

  return outcomes;
}

/** The app's own upload folder, always scanned regardless of configuration. */
export async function drainDefaultDirectory(): Promise<ImportOutcome[]> {
  return drainDirectory(importDir());
}

function describeBatch(batch: NormalizedBatch): {
  count: number;
  first: string | null;
  last: string | null;
} {
  let count = 0;
  let first: string | null = null;
  let last: string | null = null;

  const note = (day: string) => {
    if (!first || day < first) first = day;
    if (!last || day > last) last = day;
  };

  for (const group of Object.values(batch)) {
    if (!Array.isArray(group)) continue;
    for (const rec of group as { day?: string }[]) {
      count += 1;
      if (rec.day) note(rec.day);
    }
  }

  return { count, first, last };
}

function advanceWatermark(sourceId: string, lastDay: string | null): void {
  if (!lastDay) return;
  // Only ever forwards: an old export must not rewind the cursor and cause the
  // next API sync to re-fetch months it already has.
  const current = one<{ cursor: string | null }>('SELECT cursor FROM sources WHERE id = ?', [sourceId]);
  if (current && (current.cursor == null || lastDay > current.cursor)) {
    run('UPDATE sources SET cursor = ? WHERE id = ?', [lastDay, sourceId]);
  }
}

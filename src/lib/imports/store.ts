import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { all, one, run } from '../db';
import type { ImportFile } from '../connectors/types';

/**
 * Where imported files live and what we remember about them.
 *
 * Files are kept rather than parsed-and-discarded so an import can be re-run
 * after a parser improves, and so "where did this row come from" has an answer
 * that outlives the sync run.
 */

const HEAD_BYTES = 8192;

export function importDir(): string {
  const dir = process.env.VITALIS_IMPORT_DIR || path.join(process.cwd(), 'data', 'imports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ImportRow {
  id: string;
  source_id: string;
  filename: string;
  stored_path: string | null;
  bytes: number;
  sha256: string;
  imported_at: string;
  status: string;
  records: number;
  inserted: number;
  updated: number;
  skipped: number;
  first_day: string | null;
  last_day: string | null;
  error: string | null;
}

export function listImports(limit = 50): ImportRow[] {
  return all<ImportRow>('SELECT * FROM imports ORDER BY imported_at DESC LIMIT ?', [limit]);
}

export function findImportByHash(sha256: string): ImportRow | null {
  return one<ImportRow>('SELECT * FROM imports WHERE sha256 = ?', [sha256]);
}

/** Used by the watched-directory drain to skip files it already consumed. */
export function findImportByPath(storedPath: string): ImportRow | null {
  return one<ImportRow>('SELECT * FROM imports WHERE stored_path = ?', [storedPath]);
}

export function getImport(id: string): ImportRow | null {
  return one<ImportRow>('SELECT * FROM imports WHERE id = ?', [id]);
}

export function recordImport(row: Omit<ImportRow, 'id'> & { id?: string }): ImportRow {
  const id = row.id ?? `imp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  run(
    `INSERT INTO imports (id, source_id, filename, stored_path, bytes, sha256, imported_at,
        status, records, inserted, updated, skipped, first_day, last_day, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(sha256) DO UPDATE SET
       source_id=excluded.source_id, filename=excluded.filename,
       stored_path=excluded.stored_path, imported_at=excluded.imported_at,
       status=excluded.status, records=excluded.records, inserted=excluded.inserted,
       updated=excluded.updated, skipped=excluded.skipped, first_day=excluded.first_day,
       last_day=excluded.last_day, error=excluded.error`,
    [
      id, row.source_id, row.filename, row.stored_path, row.bytes, row.sha256, row.imported_at,
      row.status, row.records, row.inserted, row.updated, row.skipped,
      row.first_day, row.last_day, row.error,
    ],
  );
  return getImport(id) ?? findImportByHash(row.sha256)!;
}

/**
 * Forgets an import.
 *
 * Deliberately does **not** delete the rows it produced. Those are keyed on
 * `(source_id, external_id)` and may since have been confirmed by a later
 * export or an API sync; unpicking which rows came from which file would need
 * per-row provenance the schema does not carry, and quietly deleting a month of
 * sleep because someone tidied a file list is the worse failure.
 */
export function forgetImport(id: string): boolean {
  const row = getImport(id);
  if (!row) return false;
  if (row.stored_path) {
    try {
      fs.unlinkSync(row.stored_path);
    } catch {
      /* already gone — the registry row is what matters */
    }
  }
  run('DELETE FROM imports WHERE id = ?', [id]);
  return true;
}

/** Copies bytes into the import directory under a collision-proof name. */
export async function stageBuffer(filename: string, bytes: Buffer): Promise<ImportFile> {
  const dir = importDir();
  const safe = safeName(filename);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `${stamp}-${safe}`);
  await fsp.writeFile(dest, bytes);
  return describeFile(dest, filename);
}

/** Wraps a file already on disk (the watched-directory path). */
export async function describeFile(fullPath: string, filename?: string): Promise<ImportFile> {
  const stat = await fsp.stat(fullPath);
  const fh = await fsp.open(fullPath, 'r');
  let head = '';
  try {
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
    if (buf.length) await fh.read(buf, 0, buf.length, 0);
    head = buf.toString('utf8');
  } finally {
    await fh.close();
  }

  return {
    filename: filename ?? path.basename(fullPath),
    path: fullPath,
    size: stat.size,
    head,
    async text() {
      // 64 MiB is far above any CSV export and far below an Apple XML dump, so
      // it catches "someone handed the text path a 400 MB file" before the
      // process dies rather than after.
      if (stat.size > 64 * 1024 * 1024) {
        throw new Error(
          `${path.basename(fullPath)} is ${(stat.size / 1e6).toFixed(0)} MB — too large to read as text. ` +
            'Only Apple Health exports are expected at that size, and those are read as a stream.',
        );
      }
      return fsp.readFile(fullPath, 'utf8');
    },
  };
}

export async function hashFile(fullPath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const fh = await fsp.open(fullPath, 'r');
  try {
    for await (const chunk of fh.createReadStream({ autoClose: false })) {
      hash.update(chunk as Buffer);
    }
  } finally {
    await fh.close();
  }
  return hash.digest('hex');
}

/** Files sitting in a watched directory, newest last so imports read in order. */
export async function scanDirectory(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const files: { path: string; mtime: number }[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    try {
      const stat = await fsp.stat(full);
      if (stat.isFile() && stat.size > 0) files.push({ path: full, mtime: stat.mtimeMs });
    } catch {
      /* raced with a delete */
    }
  }
  return files.sort((a, b) => a.mtime - b.mtime).map((f) => f.path);
}

function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.-]+/g, '_').slice(0, 120) || 'upload';
}

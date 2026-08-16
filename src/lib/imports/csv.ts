/**
 * CSV parsing for vendor exports.
 *
 * Written by hand rather than pulled in, because the awkward parts here are not
 * the ones a library would solve for us: every vendor names its columns
 * differently, half of them wrap values containing commas in quotes and half
 * escape them, and the headers drift between export versions. What matters is
 * tolerant *column matching*, which is the second half of this file.
 */

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, BOM tolerated. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A trailing newline shouldn't produce a phantom one-empty-field row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (c === ',') {
      endField();
      i += 1;
    } else if (c === '\r') {
      i += 1; // CRLF — the \n does the work
    } else if (c === '\n') {
      endRow();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }

  if (field !== '' || row.length) endRow();
  return rows;
}

/** A header row plus its data rows, addressed by tolerant column lookup. */
export class CsvTable {
  readonly header: string[];
  readonly rows: string[][];
  private readonly index: Map<string, number>;

  constructor(rows: string[][]) {
    this.header = rows[0] ?? [];
    this.rows = rows.slice(1);
    this.index = new Map();
    this.header.forEach((h, i) => {
      const key = normalizeHeader(h);
      if (key && !this.index.has(key)) this.index.set(key, i);
    });
  }

  /**
   * Finds a column by any of several candidate names, matching loosely:
   * case, spacing, punctuation and trailing unit annotations are ignored, so
   * `Fat (g)`, `fat_g` and `FAT` all resolve to the same column.
   */
  column(...candidates: string[]): number {
    for (const c of candidates) {
      const key = normalizeHeader(c);
      const exact = this.index.get(key);
      if (exact != null) return exact;
    }
    // Fall back to prefix matching so `Calories` finds `Calories (kcal)`.
    for (const c of candidates) {
      const key = normalizeHeader(c);
      for (const [have, i] of this.index) {
        if (have.startsWith(key) || key.startsWith(have)) return i;
      }
    }
    return -1;
  }

  has(...candidates: string[]): boolean {
    return this.column(...candidates) >= 0;
  }

  /** Reads a cell by column candidates; empty string when the column is absent. */
  cell(row: string[], ...candidates: string[]): string {
    const i = this.column(...candidates);
    return i >= 0 ? (row[i] ?? '').trim() : '';
  }

  /** Numeric cell, tolerating thousands separators and stray units. */
  num(row: string[], ...candidates: string[]): number | undefined {
    const raw = this.cell(row, ...candidates);
    if (!raw) return undefined;
    const cleaned = raw.replace(/,/g, '').replace(/[^\d.+-eE]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\(.*?\)/g, '')       // drop unit annotations: "Fat (g)" → "fat"
    .replace(/[^a-z0-9]+/g, '')    // then all punctuation and spacing
    .trim();
}

/**
 * Vendor exports date things every way there is. Returns a `YYYY-MM-DD` key or
 * null — null rather than a guess, because a misparsed date silently files a
 * meal or a lab result under the wrong day, which is worse than skipping it.
 */
export function parseDayKey(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // 2026-08-16, optionally with a time component.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 08/16/2026 or 16/08/2026 — ambiguous, resolved by which field exceeds 12.
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = slash[3];
    const [month, day] = a > 12 ? [b, a] : [a, b];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  // "August 16, 2026" / "16 Aug 2026"
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

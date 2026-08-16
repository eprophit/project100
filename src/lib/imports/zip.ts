import fsp from 'node:fs/promises';
import zlib from 'node:zlib';

/**
 * Minimal ZIP reader — enough to pull one entry out of an Apple Health
 * `export.zip`, and nothing more.
 *
 * Apple ships the export as a zip whether you ask for it or not, so a health
 * app that cannot open one is asking every user to find a terminal first. The
 * alternative was a dependency; the whole format we need is a central
 * directory plus deflate, and Node already has the inflater, so this is ~140
 * lines instead.
 *
 * Only the two storage methods that occur in practice are supported: stored
 * (0) and deflate (8). Anything else is reported by name rather than silently
 * producing garbage.
 */

const EOCD_SIG = 0x0605_4b50;
const CD_SIG = 0x0201_4b50;
const LFH_SIG = 0x0403_4b50;

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  /** Offset of the local file header, not of the data. */
  headerOffset: number;
}

/** Reads the central directory. Cheap — it only touches the tail of the file. */
export async function listZipEntries(path: string): Promise<ZipEntry[]> {
  const fd = await fsp.open(path, 'r');
  try {
    const { size } = await fd.stat();

    // The end-of-central-directory record sits at the very end unless the zip
    // carries a comment, which can be up to 64 KiB. Scan back over that window.
    const tailLen = Math.min(size, 66_000);
    const tail = Buffer.alloc(tailLen);
    await fd.read(tail, 0, tailLen, size - tailLen);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record).');

    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);

    const cd = Buffer.alloc(cdSize);
    await fd.read(cd, 0, cdSize, cdOffset);

    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== CD_SIG) break;
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);

      entries.push({
        method: cd.readUInt16LE(p + 10),
        compressedSize: cd.readUInt32LE(p + 20),
        uncompressedSize: cd.readUInt32LE(p + 24),
        headerOffset: cd.readUInt32LE(p + 42),
        name: cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fd.close();
  }
}

/**
 * Streams one entry's decompressed bytes to `onChunk`.
 *
 * Streaming rather than returning a Buffer because the entry this exists for —
 * Apple's `export.xml` — is routinely hundreds of megabytes uncompressed, and
 * the caller wants a small filtered subset of it. Inflating the whole thing
 * into memory to throw most of it away would be the obvious way to make a
 * large export fail on a laptop.
 */
export async function readZipEntry(
  path: string,
  entry: ZipEntry,
  onChunk: (chunk: Buffer) => void,
): Promise<void> {
  const fd = await fsp.open(path, 'r');
  try {
    // The central directory records the *header* offset, and the local header's
    // name and extra fields can differ in length from the central copy, so the
    // data offset has to be read from the local header rather than assumed.
    const lfh = Buffer.alloc(30);
    await fd.read(lfh, 0, 30, entry.headerOffset);
    if (lfh.readUInt32LE(0) !== LFH_SIG) {
      throw new Error(`Corrupt zip: no local header for ${entry.name}.`);
    }
    const start = entry.headerOffset + 30 + lfh.readUInt16LE(26) + lfh.readUInt16LE(28);

    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(
        `${entry.name} uses zip compression method ${entry.method}; only stored and deflate are supported.`,
      );
    }

    const raw = fd.createReadStream({
      start,
      end: start + entry.compressedSize - 1,
      autoClose: false,
    });

    if (entry.method === 0) {
      for await (const chunk of raw) onChunk(chunk as Buffer);
      return;
    }

    const inflate = zlib.createInflateRaw();
    raw.pipe(inflate);
    for await (const chunk of inflate) onChunk(chunk as Buffer);
  } finally {
    await fd.close();
  }
}

/** Picks an entry by filename suffix, ignoring any directory prefix. */
export function findEntry(entries: ZipEntry[], suffix: string): ZipEntry | undefined {
  const want = suffix.toLowerCase();
  return entries.find((e) => e.name.toLowerCase().endsWith(want));
}

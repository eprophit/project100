import fsp from 'node:fs/promises';
import { findEntry, listZipEntries, readZipEntry } from './zip';

/**
 * Streaming scanner for Apple Health's `export.xml`.
 *
 * Not a general XML parser, deliberately. A real export is a flat sequence of
 * self-closing `<Record>` and `<Workout>` elements, and for anyone who wears a
 * watch it is dominated by heart-rate and step samples — hundreds of megabytes
 * of data this app has no use for. A DOM parse would need the whole document
 * resident to throw ~98% of it away.
 *
 * So: read in chunks, find element boundaries, and decide from the `type`
 * attribute whether to keep the element before doing any further work. Memory
 * stays proportional to what we keep, not to the file.
 *
 * The output shape is exactly what `appleHealth.normalize()` already consumes,
 * so the file path and the API path converge one step later.
 *
 * Timestamps are passed through as Apple writes them —
 * `YYYY-MM-DD HH:MM:SS ±ZZZZ` — and `normalize()` reads the wall-clock part and
 * ignores the offset. That is deliberate for a day-keyed app: a session at
 * 18:00 local belongs to that local day, and converting to true UTC first
 * would move evening sessions in western timezones onto the following day.
 */

const WANTED_TYPES = new Set([
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierRespiratoryRate',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierBodyFatPercentage',
  'HKQuantityTypeIdentifierLeanBodyMass',
  'HKQuantityTypeIdentifierVO2Max',
]);

export interface ScanResult {
  records: unknown[];
  /** Elements seen in total, including the ones filtered out. */
  scanned: number;
}

/** Accepts either `export.xml` or the `export.zip` Apple actually hands you. */
export async function scanAppleExport(path: string, filename: string): Promise<ScanResult> {
  if (/\.zip$/i.test(filename)) {
    const entries = await listZipEntries(path);
    const entry = findEntry(entries, 'export.xml');
    if (!entry) {
      const names = entries.map((e) => e.name).slice(0, 8).join(', ');
      throw new Error(`No export.xml inside the zip. Entries: ${names || 'none'}`);
    }
    return scanStream(async (onChunk) => readZipEntry(path, entry, onChunk));
  }

  return scanStream(async (onChunk) => {
    const fh = await fsp.open(path, 'r');
    try {
      for await (const chunk of fh.createReadStream({ autoClose: false })) {
        onChunk(chunk as Buffer);
      }
    } finally {
      await fh.close();
    }
  });
}

async function scanStream(
  pump: (onChunk: (c: Buffer) => void) => Promise<void>,
): Promise<ScanResult> {
  const records: unknown[] = [];
  let scanned = 0;

  // Elements can straddle chunk boundaries, so unconsumed text carries over.
  let carry = '';
  // Workouts are the one element with children we care about (metadata), so
  // they are accumulated across chunks until their closing tag arrives.
  let openWorkout: string | null = null;

  const consume = (text: string) => {
    let cursor = 0;

    while (cursor < text.length) {
      if (openWorkout !== null) {
        const close = text.indexOf('</Workout>', cursor);
        if (close < 0) {
          openWorkout += text.slice(cursor);
          cursor = text.length;
          break;
        }
        openWorkout += text.slice(cursor, close);
        const workout = parseWorkout(openWorkout);
        scanned += 1;
        if (workout) records.push(workout);
        openWorkout = null;
        cursor = close + '</Workout>'.length;
        continue;
      }

      const lt = text.indexOf('<', cursor);
      if (lt < 0) {
        cursor = text.length;
        break;
      }

      // A chunk can end mid-element-name, in which case we cannot yet tell
      // whether this is one we want. Carry it rather than deciding wrongly.
      if (text.length - lt < 10) {
        carry = text.slice(lt);
        return;
      }

      const isRecord = text.startsWith('<Record ', lt);
      const isWorkout = text.startsWith('<Workout ', lt);
      if (!isRecord && !isWorkout) {
        // Not an element we care about. Skip past its opening bracket only —
        // skipping to the next '>' would break on quoted attribute text.
        cursor = lt + 1;
        continue;
      }

      const gt = findTagEnd(text, lt);
      if (gt < 0) {
        // Tag is cut off by the chunk boundary; retry once more text arrives.
        carry = text.slice(lt);
        return;
      }

      const tag = text.slice(lt, gt + 1);

      if (isRecord) {
        scanned += 1;
        const type = attr(tag, 'type');
        // The cheap check first: most elements in a real export lose here, and
        // never get their remaining attributes parsed at all.
        if (type && WANTED_TYPES.has(type)) {
          const rec = parseRecord(tag, type);
          if (rec) records.push(rec);
        }
        cursor = gt + 1;
        continue;
      }

      // <Workout ...> — self-closing or with a metadata body.
      if (tag.endsWith('/>')) {
        scanned += 1;
        const workout = parseWorkout(tag);
        if (workout) records.push(workout);
        cursor = gt + 1;
      } else {
        openWorkout = tag;
        cursor = gt + 1;
      }
    }

    carry = '';
  };

  await pump((chunk) => {
    const text = carry + chunk.toString('utf8');
    carry = '';
    consume(text);
  });

  if (carry) consume(carry);
  return { records, scanned };
}

/**
 * Finds the `>` that closes a tag, ignoring any inside quoted attribute values.
 * Apple's workout notes and metadata routinely contain `>`.
 */
function findTagEnd(text: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeEntities(m[1]) : undefined;
}

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" survives as "&lt;"
}

function parseRecord(tag: string, type: string): unknown | null {
  const startDate = attr(tag, 'startDate');
  const endDate = attr(tag, 'endDate') ?? startDate;
  const value = attr(tag, 'value');
  if (!startDate || value == null) return null;

  return {
    kind: 'sample',
    type,
    sourceName: attr(tag, 'sourceName') ?? 'Apple Health',
    startDate,
    endDate,
    // Sleep values are strings ("HKCategoryValueSleepAnalysisAsleepREM");
    // quantity values are numeric. normalize() handles both, so keep whichever
    // it actually is rather than coercing.
    value: Number.isFinite(Number(value)) && value.trim() !== '' ? Number(value) : value,
    unit: attr(tag, 'unit'),
  };
}

function parseWorkout(xml: string): unknown | null {
  const startDate = attr(xml, 'startDate');
  const activity = attr(xml, 'workoutActivityType');
  if (!startDate || !activity) return null;

  const metadata: Record<string, string> = {};
  // <MetadataEntry key="..." value="..."/>, repeated.
  const meta = /<MetadataEntry\s+key="([^"]*)"\s+value="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = meta.exec(xml)) !== null) {
    metadata[decodeEntities(m[1])] = decodeEntities(m[2]);
  }

  // Newer exports moved distance and energy out of attributes and into
  // <WorkoutStatistics> children, so try both.
  const stat = (suffix: string): number | undefined => {
    const re = new RegExp(
      `<WorkoutStatistics[^>]*type="HKQuantityTypeIdentifier${suffix}"[^>]*sum="([\\d.]+)"`,
    );
    const found = re.exec(xml);
    return found ? Number(found[1]) : undefined;
  };

  const durationUnit = attr(xml, 'durationUnit') ?? 'min';
  const duration = Number(attr(xml, 'duration') ?? '0');

  const distanceAttr = attr(xml, 'totalDistance');
  const distanceUnit = attr(xml, 'totalDistanceUnit') ?? 'km';
  const distance = distanceAttr != null ? Number(distanceAttr) : (stat('DistanceWalkingRunning') ?? stat('DistanceCycling'));

  const energyAttr = attr(xml, 'totalEnergyBurned');
  const energy = energyAttr != null ? Number(energyAttr) : stat('ActiveEnergyBurned');

  return {
    kind: 'workout',
    workoutActivityType: activity,
    sourceName: attr(xml, 'sourceName') ?? 'Apple Health',
    startDate,
    endDate: attr(xml, 'endDate') ?? startDate,
    // normalize() expects minutes and kilometres, which is what Apple writes
    // by default; convert when an export declares something else.
    duration: durationUnit === 'sec' ? duration / 60 : duration,
    durationUnit: 'min',
    totalDistance: distance != null && distanceUnit === 'mi' ? distance * 1.609344 : distance,
    totalDistanceUnit: distance != null ? 'km' : undefined,
    totalEnergyBurned: energy,
    totalEnergyBurnedUnit: energy != null ? 'kcal' : undefined,
    metadata,
  };
}

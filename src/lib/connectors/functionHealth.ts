import { CsvTable, parseCsv, parseDayKey } from '../imports/csv';
import { biomarkerPanels } from '../sim/athlete';
import { pageWindow, simulateCall } from './transport';
import {
  type BiomarkerInput,
  type Connector,
  type FetchContext,
  type FetchPage,
  type NormalizedBatch,
} from './types';

/**
 * Function Health.
 *
 * Unlike the daily streams, labs are episodic: a handful of panels a year, each
 * a document containing ~30 biomarkers with both a clinical reference range and
 * a narrower "optimal" range. The status flag is derived here rather than
 * trusted, because providers disagree about whether "optimal" is a subset of
 * "in range".
 */

const PAGE_DAYS = 200;

interface FhBiomarker {
  name: string;
  slug: string;
  category: string;
  value: number;
  unit: string;
  reference_range: { low: number | null; high: number | null };
  optimal_range: { low: number | null; high: number | null };
}

interface FhPanel {
  panel_id: string;
  panel_name: string;
  collected_at: string; // ISO datetime
  released_at: string;
  biomarkers: FhBiomarker[];
}

export const functionHealth: Connector = {
  id: 'function_health',
  name: 'Function Health',
  vendor: 'Function Health',
  domains: ['biomarkers'],
  authMode: 'oauth',
  credentialEnv: 'FUNCTION_HEALTH_TOKEN',
  liveVia: 'file_import',
  integrationNote:
    'Function Health publishes no member API, so panels arrive as a downloaded results file. Upload the CSV here, or set FUNCTION_HEALTH_TOKEN to a folder and results dropped there are ingested on the next sync.',
  backfillDays: 400,

  fileImport: {
    instructions:
      'In your Function Health dashboard, download your results as CSV (one row per biomarker) and upload it here. Panels are grouped by collection date automatically.',
    accept: ['.csv'],
    matches(file) {
      if (!/\.csv$/i.test(file.filename)) return false;
      const head = file.head.toLowerCase();
      const looksLikeLabs =
        head.includes('biomarker') || head.includes('marker') || head.includes('test name') ||
        (head.includes('result') && head.includes('unit'));
      // A food diary also has "unit"; the meal column is what separates them.
      return looksLikeLabs && !head.includes('meal');
    },
    async parse(file) {
      return { biomarkers: parseResultsCsv(await file.text()) };
    },
  },

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    const window = pageWindow(ctx.since, ctx.cursor, PAGE_DAYS);
    await simulateCall('function_health', window, ctx.attempt);

    const inWindow = biomarkerPanels().filter((b) => b.day >= window.from && b.day <= window.to);

    const byPanel = new Map<string, FhPanel>();
    for (const b of inWindow) {
      let panel = byPanel.get(b.panel);
      if (!panel) {
        panel = {
          panel_id: `pnl_${b.day.replace(/-/g, '')}`,
          panel_name: b.panel,
          collected_at: `${b.day}T08:15:00Z`,
          released_at: `${b.day}T08:15:00Z`,
          biomarkers: [],
        };
        byPanel.set(b.panel, panel);
      }
      panel.biomarkers.push({
        name: b.name,
        slug: b.slug,
        category: b.category,
        value: b.value,
        unit: b.unit,
        reference_range: { low: b.refLow, high: b.refHigh },
        optimal_range: { low: b.optimalLow, high: b.optimalHigh },
      });
    }

    return { records: [...byPanel.values()], nextCursor: window.nextCursor };
  },

  normalize(records: unknown[]): NormalizedBatch {
    const biomarkers: BiomarkerInput[] = [];

    for (const panel of records as FhPanel[]) {
      const day = panel.collected_at.slice(0, 10);
      for (const b of panel.biomarkers) {
        biomarkers.push({
          externalId: `${panel.panel_id}:${b.slug}`,
          day,
          panel: panel.panel_name,
          category: b.category,
          name: b.name,
          slug: b.slug,
          value: b.value,
          unit: b.unit,
          refLow: b.reference_range.low,
          refHigh: b.reference_range.high,
          optimalLow: b.optimal_range.low,
          optimalHigh: b.optimal_range.high,
        });
      }
    }

    return { biomarkers };
  },
};

/**
 * Parses a downloaded lab-results CSV into biomarkers.
 *
 * Lab exports are the least standardised file this app reads: the reference
 * range may be two numeric columns or one string like "0.4 - 4.0", "<5" or
 * "> 40". All three forms are handled, and a row whose range cannot be read
 * still imports — it just has no range, which the UI already renders as a bare
 * value rather than inventing bounds.
 */
export function parseResultsCsv(text: string): BiomarkerInput[] {
  const table = new CsvTable(parseCsv(text));
  const out: BiomarkerInput[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    const day = parseDayKey(
      table.cell(row, 'collectedon', 'collected', 'date', 'drawdate', 'resultdate', 'testdate'),
    );
    if (!day) continue;

    const name = table.cell(row, 'biomarker', 'marker', 'testname', 'test', 'name', 'analyte');
    if (!name) continue;

    const value = table.num(row, 'value', 'result', 'yourresult', 'resultvalue');
    if (value == null) continue;

    const slug = slugify(name);
    // A panel can list the same marker twice (a re-draw); keep the first.
    const key = `${day}:${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let refLow = table.num(row, 'referencelow', 'reflow', 'rangelow', 'low', 'min');
    let refHigh = table.num(row, 'referencehigh', 'refhigh', 'rangehigh', 'high', 'max');
    if (refLow == null && refHigh == null) {
      const parsed = parseRange(table.cell(row, 'referencerange', 'range', 'normalrange'));
      refLow = parsed.low;
      refHigh = parsed.high;
    }
    const optimal = parseRange(table.cell(row, 'optimalrange', 'optimal'));

    out.push({
      externalId: `csv:${day}:${slug}`,
      day,
      panel: table.cell(row, 'panel', 'paneltype') || `Panel ${day}`,
      category: table.cell(row, 'category', 'group', 'system') || 'Uncategorised',
      name,
      slug,
      value,
      unit: table.cell(row, 'unit', 'units', 'uom') || undefined,
      refLow: refLow ?? null,
      refHigh: refHigh ?? null,
      optimalLow: optimal.low ?? null,
      optimalHigh: optimal.high ?? null,
    });
  }

  return out;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Reads "0.4 - 4.0", "<5", "> 40", "0.4–4.0" into bounds. */
function parseRange(raw: string): { low?: number; high?: number } {
  const s = raw.trim();
  if (!s) return {};

  const between = /(-?[\d.]+)\s*(?:-|–|—|to)\s*(-?[\d.]+)/.exec(s);
  if (between) return { low: Number(between[1]), high: Number(between[2]) };

  const under = /^[<≤]\s*(-?[\d.]+)/.exec(s);
  if (under) return { high: Number(under[1]) };

  const over = /^[>≥]\s*(-?[\d.]+)/.exec(s);
  if (over) return { low: Number(over[1]) };

  return {};
}

/** Shared status rule so the UI and the LLM tools agree on what "optimal" means. */
export function biomarkerStatus(m: {
  value: number;
  ref_low: number | null;
  ref_high: number | null;
  optimal_low: number | null;
  optimal_high: number | null;
}): 'optimal' | 'in_range' | 'out_of_range' {
  const within = (lo: number | null, hi: number | null) =>
    (lo == null || m.value >= lo) && (hi == null || m.value <= hi);

  if (!within(m.ref_low, m.ref_high)) return 'out_of_range';
  if ((m.optimal_low != null || m.optimal_high != null) && within(m.optimal_low, m.optimal_high)) {
    return 'optimal';
  }
  return 'in_range';
}

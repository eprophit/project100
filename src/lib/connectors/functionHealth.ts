import { biomarkerPanels } from '../sim/athlete';
import { pageWindow, simulateCall } from './transport';
import {
  NotConfiguredError,
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
  integrationNote:
    'Live mode calls the Function Health member API for released panels and their biomarker results, filtered by collected_at.',
  backfillDays: 400,

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    if (process.env.FUNCTION_HEALTH_TOKEN) {
      throw new NotConfiguredError('functionHealth', 'FUNCTION_HEALTH_TOKEN');
    }

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

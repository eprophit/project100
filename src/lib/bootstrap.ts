import { ensureSourcesRegistered } from './connectors/registry';
import { getDb } from './db';
import { hasIngestedData, seedLocal } from './seed';
import { syncAll } from './sync/engine';

/**
 * First-run setup. Every server entry point awaits this, so a fresh clone
 * renders a populated app without a separate setup step — the first request
 * pays for a full backfill, subsequent ones are no-ops.
 */

let inflight: Promise<void> | null = null;

export function ensureReady(): Promise<void> {
  if (inflight) return inflight;

  inflight = (async () => {
    getDb(); // applies the schema
    ensureSourcesRegistered();
    seedLocal();
    if (!hasIngestedData()) {
      await syncAll();
    }
  })().catch((err) => {
    // Don't cache a failed bootstrap — the next request should retry.
    inflight = null;
    throw err;
  });

  return inflight;
}

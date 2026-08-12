import { all, run } from '../db';
import type { SourceRow } from '../types';
import { appleHealth } from './appleHealth';
import { ergdata } from './ergdata';
import { functionHealth } from './functionHealth';
import { hrv4training } from './hrv4training';
import { myfitnesspal } from './myfitnesspal';
import { peloton } from './peloton';
import type { Connector } from './types';

export const CONNECTORS: Connector[] = [
  functionHealth,
  myfitnesspal,
  appleHealth,
  ergdata,
  peloton,
  hrv4training,
];

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/** A connector is "live" once its credential env var is present. */
export function connectorMode(c: Connector): 'demo' | 'live' {
  return process.env[c.credentialEnv] ? 'live' : 'demo';
}

/** Idempotently writes the connector registry into the DB. */
export function ensureSourcesRegistered(): void {
  for (const c of CONNECTORS) {
    run(
      `INSERT INTO sources (id, name, vendor, domains, auth_mode, mode)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         vendor = excluded.vendor,
         domains = excluded.domains,
         auth_mode = excluded.auth_mode,
         mode = excluded.mode`,
      [c.id, c.name, c.vendor, JSON.stringify(c.domains), c.authMode, connectorMode(c)],
    );
  }
}

export function listSources(): SourceRow[] {
  ensureSourcesRegistered();
  return all<SourceRow>('SELECT * FROM sources ORDER BY name');
}

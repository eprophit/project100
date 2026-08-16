import { ConnectionsClient } from './ConnectionsClient';
import { ensureReady } from '@/lib/bootstrap';
import { CONNECTORS, connectorMode, listSources } from '@/lib/connectors/registry';
import { importableConnectors } from '@/lib/imports/importer';
import { importDir, listImports } from '@/lib/imports/store';
import { coverage, recentSyncRuns } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  await ensureReady();

  const imports = listImports();
  const importsBySource = new Map<string, number>();
  for (const i of imports) importsBySource.set(i.source_id, (importsBySource.get(i.source_id) ?? 0) + 1);

  const connectorMeta = CONNECTORS.map((c) => ({
    id: c.id,
    name: c.name,
    vendor: c.vendor,
    domains: c.domains,
    authMode: c.authMode,
    credentialEnv: c.credentialEnv,
    integrationNote: c.integrationNote,
    backfillDays: c.backfillDays,
    mode: connectorMode(c),
    liveVia: c.liveVia,
    importCount: importsBySource.get(c.id) ?? 0,
  }));

  return (
    <ConnectionsClient
      initialSources={listSources()}
      initialRuns={recentSyncRuns(30)}
      connectors={connectorMeta}
      coverage={coverage()}
      importable={importableConnectors()}
      imports={imports}
      importDirectory={importDir()}
    />
  );
}

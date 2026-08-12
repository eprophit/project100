import { ConnectionsClient } from './ConnectionsClient';
import { ensureReady } from '@/lib/bootstrap';
import { CONNECTORS, connectorMode, listSources } from '@/lib/connectors/registry';
import { coverage, recentSyncRuns } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  await ensureReady();

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
  }));

  return (
    <ConnectionsClient
      initialSources={listSources()}
      initialRuns={recentSyncRuns(30)}
      connectors={connectorMeta}
      coverage={coverage()}
    />
  );
}

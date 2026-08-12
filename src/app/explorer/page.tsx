import { ExplorerClient } from './ExplorerClient';
import { ensureReady } from '@/lib/bootstrap';
import { allMetrics } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

export default async function ExplorerPage() {
  await ensureReady();
  const metrics = allMetrics().map(({ sql: _sql, ...rest }) => rest);
  return <ExplorerClient metrics={metrics} />;
}

import { NextResponse } from 'next/server';
import { ensureReady } from '@/lib/bootstrap';
import { listSources } from '@/lib/connectors/registry';
import { recentSyncRuns, coverage } from '@/lib/queries';
import { syncAll, syncSource } from '@/lib/sync/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureReady();
  return NextResponse.json({
    sources: listSources(),
    runs: recentSyncRuns(40),
    coverage: coverage(),
  });
}

/** POST { source?: string } — omit `source` to run every enabled connector. */
export async function POST(request: Request) {
  await ensureReady();

  let sourceId: string | undefined;
  try {
    const body = (await request.json()) as { source?: string };
    sourceId = body.source;
  } catch {
    // no body — sync everything
  }

  try {
    const results = sourceId ? [await syncSource(sourceId)] : await syncAll();
    return NextResponse.json({ results, sources: listSources() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

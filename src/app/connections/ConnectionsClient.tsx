'use client';

import { useState } from 'react';
import { ImportPanel, type ImportRecord, type ImportableConnector } from './ImportPanel';
import { Card, StatTile, StatusBadge } from '@/components/ui';
import type { SourceRow, SyncRunRow } from '@/lib/types';

interface ConnectorMeta {
  id: string;
  name: string;
  vendor: string;
  domains: string[];
  authMode: string;
  credentialEnv: string;
  integrationNote: string;
  backfillDays: number;
  mode: 'demo' | 'live';
  liveVia: 'api' | 'file_import';
  importCount: number;
}

type Run = SyncRunRow & { source_name: string };

interface CoverageRow {
  n: number;
  first: string | null;
  last: string | null;
}

interface SyncResult {
  sourceId: string;
  status: string;
  pages: number;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  retries: number;
  error?: string;
  durationMs: number;
}

const DOMAIN_LABEL: Record<string, string> = {
  workouts: 'Workouts',
  sleep: 'Sleep',
  recovery: 'HRV',
  nutrition: 'Nutrition',
  body: 'Body',
  biomarkers: 'Labs',
  protocols: 'Protocols',
};

export function ConnectionsClient({
  initialSources,
  initialRuns,
  connectors,
  coverage,
  importable,
  imports,
  importDirectory,
}: {
  initialSources: SourceRow[];
  initialRuns: Run[];
  connectors: ConnectorMeta[];
  coverage: Record<string, CoverageRow | null>;
  importable: ImportableConnector[];
  imports: ImportRecord[];
  importDirectory: string;
}) {
  const [sources, setSources] = useState(initialSources);
  const [runs, setRuns] = useState(initialRuns);
  const [results, setResults] = useState<SyncResult[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const sourceById = new Map(sources.map((s) => [s.id, s]));

  async function sync(sourceId?: string) {
    setBusy(sourceId ?? 'all');
    setResults([]);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sourceId ? { source: sourceId } : {}),
      });
      const data = await res.json();
      if (data.results) setResults(data.results);
      const status = await (await fetch('/api/sync')).json();
      setSources(status.sources);
      setRuns(status.runs);
    } finally {
      setBusy(null);
    }
  }

  async function refreshStatus() {
    const status = await (await fetch('/api/sync')).json();
    setSources(status.sources);
    setRuns(status.runs);
  }

  const totalRows = Object.values(coverage).reduce((s, c) => s + (c?.n ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p className="page-sub">
            Six connectors, one batch pipeline. Each pull pages the upstream, maps its wire format to the shared
            schema, and upserts on <span className="mono">(source, external_id)</span> — so re-running a sync
            changes nothing.
          </p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => sync()} disabled={busy !== null}>
          {busy === 'all' ? <span className="spin" /> : '⇄'} Sync all sources
        </button>
      </div>

      <div className="stack">
        <div className="grid grid-4">
          <StatTile label="Records ingested" value={totalRows.toLocaleString()} meta="Across all domains" />
          <StatTile label="Connectors" value={connectors.length} meta={`${connectors.filter((c) => c.mode === 'live').length} in live mode`} />
          <StatTile
            label="Workout history"
            value={coverage.workouts?.n ?? 0}
            meta={coverage.workouts?.first ? `from ${coverage.workouts.first}` : undefined}
          />
          <StatTile
            label="Biomarker results"
            value={coverage.biomarkers?.n ?? 0}
            meta={coverage.biomarkers?.last ? `latest ${coverage.biomarkers.last}` : undefined}
          />
        </div>

        {results.length ? (
          <Card title="Last run" note="Result of the sync you just triggered">
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th className="num">Pages</th>
                    <th className="num">Fetched</th>
                    <th className="num">Inserted</th>
                    <th className="num">Updated</th>
                    <th className="num">Retries</th>
                    <th className="num">Duration</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.sourceId}>
                      <td className="strong">{sourceById.get(r.sourceId)?.name ?? r.sourceId}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="num">{r.pages}</td>
                      <td className="num">{r.fetched}</td>
                      <td className="num" style={{ color: r.inserted ? 'var(--good)' : undefined }}>
                        {r.inserted}
                      </td>
                      <td className="num">{r.updated}</td>
                      <td className="num">{r.retries}</td>
                      <td className="num">{r.durationMs} ms</td>
                      <td className="small muted">{r.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
              A second sync of the same window inserts nothing and updates the rows it re-read — that is the
              dedupe working, not a no-op. Retries above are transient upstream failures (429/503) that the
              engine recovered from with backoff.
            </p>
          </Card>
        ) : null}

        <div className="grid grid-2">
          {connectors.map((c) => {
            const src = sourceById.get(c.id);
            return (
              <Card
                key={c.id}
                title={c.name}
                note={c.vendor}
                action={
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => sync(c.id)}
                    disabled={busy !== null}
                  >
                    {busy === c.id ? <span className="spin" /> : '⇄'} Sync
                  </button>
                }
              >
                <div className="row" style={{ marginBottom: 12 }}>
                  {c.domains.map((d) => (
                    <span className="badge" key={d}>
                      {DOMAIN_LABEL[d] ?? d}
                    </span>
                  ))}
                  <span className="spacer" />
                  <StatusBadge status={src?.last_status ?? null} />
                </div>

                <table>
                  <tbody>
                    <tr>
                      <td className="muted">Mode</td>
                      <td className="strong">
                        {c.mode === 'live' ? 'Live' : 'Demo'}
                        <span className="muted small">
                          {' '}
                          · {c.mode === 'live' ? `${c.credentialEnv} is set` : `set ${c.credentialEnv} to go live`}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">Real data via</td>
                      <td>
                        {c.liveVia === 'api' ? (
                          <>
                            API <span className="muted small">· {c.authMode.replace('_', ' ')}</span>
                          </>
                        ) : (
                          <>
                            File import
                            <span className="muted small">
                              {' '}
                              · {c.importCount
                                ? `${c.importCount} file${c.importCount === 1 ? '' : 's'} imported`
                                : 'no vendor API — upload an export below'}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">Watermark</td>
                      <td className="mono">{src?.cursor ?? 'never synced'}</td>
                    </tr>
                    <tr>
                      <td className="muted">Last sync</td>
                      <td className="mono">
                        {src?.last_sync_at ? new Date(src.last_sync_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">Backfill</td>
                      <td>{c.backfillDays} days</td>
                    </tr>
                  </tbody>
                </table>

                {src?.last_error ? (
                  <p className="small" style={{ color: 'var(--critical)', marginBottom: 0 }}>
                    ▲ {src.last_error}
                  </p>
                ) : null}

                <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  {c.integrationNote}
                </p>
              </Card>
            );
          })}
        </div>

        <ImportPanel
          connectors={importable}
          directory={importDirectory}
          initialImports={imports}
          onChanged={() => void refreshStatus()}
        />

        <Card title="Sync history" note="Every batch pull, with what it cost">
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="num">Pages</th>
                  <th className="num">Fetched</th>
                  <th className="num">Ins</th>
                  <th className="num">Upd</th>
                  <th className="num">Retries</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono nowrap">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="strong">{r.source_name}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="num">{r.pages}</td>
                    <td className="num">{r.fetched}</td>
                    <td className="num">{r.inserted}</td>
                    <td className="num">{r.updated}</td>
                    <td className="num">{r.retries}</td>
                    <td className="small muted" style={{ maxWidth: 260 }}>
                      {r.error ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Coverage by domain">
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th className="num">Rows</th>
                  <th>First</th>
                  <th>Latest</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(coverage).map(([domain, c]) => (
                  <tr key={domain}>
                    <td className="strong" style={{ textTransform: 'capitalize' }}>
                      {domain}
                    </td>
                    <td className="num">{(c?.n ?? 0).toLocaleString()}</td>
                    <td className="mono muted">{c?.first ?? '—'}</td>
                    <td className="mono muted">{c?.last ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

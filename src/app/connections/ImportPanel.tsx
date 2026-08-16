'use client';

import { useRef, useState } from 'react';
import { Card, StatusBadge } from '@/components/ui';

/**
 * Upload a vendor export.
 *
 * The panel leads with the instructions rather than the file picker, because
 * the hard part of this feature is not choosing a file — it is knowing that
 * Apple Health hides its export behind a profile picture, and that MyFitnessPal
 * emails you the CSV rather than downloading it.
 */

export interface ImportableConnector {
  id: string;
  name: string;
  vendor: string;
  domains: string[];
  accept: string[];
  instructions: string;
}

export interface ImportRecord {
  id: string;
  source_id: string;
  filename: string;
  bytes: number;
  imported_at: string;
  status: string;
  records: number;
  inserted: number;
  updated: number;
  skipped: number;
  first_day: string | null;
  last_day: string | null;
  error: string | null;
}

interface Outcome {
  sourceId: string | null;
  filename: string;
  status: 'ok' | 'error' | 'duplicate' | 'unrecognised';
  records: number;
  inserted: number;
  updated: number;
  firstDay: string | null;
  lastDay: string | null;
  error?: string;
}

export function ImportPanel({
  connectors,
  directory,
  initialImports,
  onChanged,
}: {
  connectors: ImportableConnector[];
  directory: string;
  initialImports: ImportRecord[];
  onChanged?: () => void;
}) {
  const [imports, setImports] = useState(initialImports);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [dragging, setDragging] = useState(false);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nameById = new Map(connectors.map((c) => [c.id, c.name]));
  const accept = [...new Set(connectors.flatMap((c) => c.accept))].join(',');

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setProgress(`Reading ${file.name} (${formatBytes(file.size)})…`);

    try {
      const body = new FormData();
      body.append('file', file);
      if (source) body.append('source', source);

      const res = await fetch('/api/imports', { method: 'POST', body });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Upload failed.');
        return;
      }
      setOutcome(data.outcome as Outcome);
      setImports(data.imports as ImportRecord[]);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function forget(id: string) {
    if (!window.confirm('Forget this import? The data it added stays — only the record of the file is removed.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/imports?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setImports(data.imports as ImportRecord[]);
        onChanged?.();
      } else {
        setError(data.error ?? 'Could not remove that import.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Import an export"
      note="Four of the six vendors publish no usable API. This is the route that actually works for them: export a file, drop it here. Re-importing an overlapping export updates rows rather than duplicating them."
    >
      <div
        className={`dropzone${dragging ? ' dropzone-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <div className="strong">{busy ? (progress ?? 'Importing…') : 'Drop an export here'}</div>
        <div className="small muted">
          {accept.replace(/,/g, ' · ')} — the source is detected from the file, so you rarely need to say which
        </div>
        <div className="row-tight" style={{ marginTop: 10 }}>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Choose a file
          </button>
          <select value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} aria-label="Source">
            <option value="">Detect automatically</option>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <div className="banner banner-error">{error}</div> : null}
      {outcome ? <OutcomeBanner outcome={outcome} name={nameById.get(outcome.sourceId ?? '')} /> : null}

      <p className="small muted" style={{ marginTop: 12 }}>
        Files are kept in <span className="mono">{directory}</span>. Anything dropped straight into that folder is
        picked up on the next sync, so a vendor&apos;s own scheduled export can be pointed at it and left alone.
      </p>

      <div className="import-help">
        {connectors.map((c) => (
          <div key={c.id}>
            <button
              type="button"
              className="link-btn small"
              onClick={() => setOpenHelp(openHelp === c.id ? null : c.id)}
            >
              {openHelp === c.id ? '▾' : '▸'} How do I export from {c.name}?
            </button>
            {openHelp === c.id ? <p className="small muted import-steps">{c.instructions}</p> : null}
          </div>
        ))}
      </div>

      {imports.length ? (
        <div className="scroll-x" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Imported</th>
                <th>File</th>
                <th>Source</th>
                <th>Status</th>
                <th className="num">Rows</th>
                <th className="num">New</th>
                <th className="num">Updated</th>
                <th>Covers</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td className="mono nowrap small">{new Date(i.imported_at).toLocaleString()}</td>
                  <td className="strong">
                    {i.filename}
                    <div className="small muted">{formatBytes(i.bytes)}</div>
                    {i.error ? <div className="small import-note">{i.error}</div> : null}
                  </td>
                  <td>{nameById.get(i.source_id) ?? i.source_id}</td>
                  <td>
                    <StatusBadge status={i.status} />
                  </td>
                  <td className="num">{i.records.toLocaleString()}</td>
                  <td className="num">{i.inserted.toLocaleString()}</td>
                  <td className="num">{i.updated.toLocaleString()}</td>
                  <td className="mono small nowrap">
                    {i.first_day ? `${i.first_day} → ${i.last_day}` : '—'}
                  </td>
                  <td style={{ width: 30 }}>
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={busy}
                      aria-label={`Forget ${i.filename}`}
                      onClick={() => forget(i.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty" style={{ marginTop: 12 }}>
          Nothing imported yet.
        </div>
      )}
    </Card>
  );
}

function OutcomeBanner({ outcome, name }: { outcome: Outcome; name?: string }) {
  if (outcome.status === 'ok' && outcome.records === 0) {
    return (
      <div className="banner banner-error">
        <span className="strong">{outcome.filename}</span> parsed cleanly but held no rows this app tracks — check
        you exported the right data type.
      </div>
    );
  }

  if (outcome.status === 'ok') {
    const range = outcome.firstDay ? ` covering ${outcome.firstDay} → ${outcome.lastDay}` : '';
    return (
      <div className="banner">
        Imported <span className="strong">{outcome.filename}</span> as {name ?? outcome.sourceId}:{' '}
        {outcome.records.toLocaleString()} rows{range} — {outcome.inserted.toLocaleString()} new,{' '}
        {outcome.updated.toLocaleString()} updated.
      </div>
    );
  }

  if (outcome.status === 'duplicate') {
    return (
      <div className="banner">
        <span className="strong">{outcome.filename}</span> is byte-identical to a file already imported, so nothing
        was reprocessed. Export a fresh range if you want newer data.
      </div>
    );
  }

  return <div className="banner banner-error">{outcome.error ?? 'Import failed.'}</div>;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

'use client';

import { useState } from 'react';
import { MetricChart } from '@/components/charts';
import { SERIES_COLORS } from '@/lib/palette';
import { Card, Meter } from '@/components/ui';
import type { Supplement } from '@/lib/types';

type SupplementRow = Supplement & { taken: number | null; log_id: string | null };
interface ProtocolRow {
  id: string;
  day: string;
  kind: string;
  minutes: number;
  intensity: string;
  notes: string;
}

const PROTOCOL_KINDS = [
  { kind: 'sauna', label: 'Sauna', defaultMinutes: 20, defaultIntensity: '82°C' },
  { kind: 'cold_plunge', label: 'Cold plunge', defaultMinutes: 4, defaultIntensity: '9°C' },
  { kind: 'breathwork', label: 'Breathwork', defaultMinutes: 10, defaultIntensity: 'box 4-4-4-4' },
  { kind: 'massage', label: 'Massage', defaultMinutes: 60, defaultIntensity: 'deep tissue' },
  { kind: 'stretching', label: 'Stretching', defaultMinutes: 15, defaultIntensity: 'static' },
  { kind: 'nap', label: 'Nap', defaultMinutes: 25, defaultIntensity: '' },
];

const TIMING_LABEL: Record<string, string> = {
  am: 'Morning',
  pm: 'Evening',
  pre: 'Pre-session',
  post: 'Post-session',
  with_meal: 'With food',
};

export function RecoveryClient({
  initialDay,
  initialSupplements,
  initialProtocols,
  protocolTotals,
  adherence,
  efficiencyPoints,
}: {
  initialDay: string;
  initialSupplements: SupplementRow[];
  initialProtocols: ProtocolRow[];
  protocolTotals: { kind: string; sessions: number; minutes: number }[];
  adherence: { id: string; name: string; due: number; taken: number; pct: number }[];
  efficiencyPoints: { day: string; value: number }[];
}) {
  const [day, setDay] = useState(initialDay);
  const [supplements, setSupplements] = useState(initialSupplements);
  const [protocols, setProtocols] = useState(initialProtocols);
  const [custom, setCustom] = useState({ kind: 'sauna', minutes: 20, intensity: '', notes: '' });
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, ...body }),
      });
      const data = await res.json();
      setSupplements(data.supplements);
      setProtocols(data.protocols);
    } finally {
      setBusy(false);
    }
  }

  async function changeDay(next: string) {
    setDay(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/recovery?day=${next}`);
      const data = await res.json();
      setSupplements(data.supplements);
      setProtocols(data.protocols);
    } finally {
      setBusy(false);
    }
  }

  const taken = supplements.filter((s) => s.taken).length;
  const grouped = new Map<string, SupplementRow[]>();
  for (const s of supplements) {
    const key = s.timing ?? 'other';
    grouped.set(key, [...(grouped.get(key) ?? []), s]);
  }

  return (
    <>
      <div className="grid grid-2">
        <Card
          title="Supplement stack"
          note={`${taken}/${supplements.length} taken`}
          action={<input type="date" value={day} onChange={(e) => changeDay(e.target.value)} />}
        >
          <div style={{ marginBottom: 14 }}>
            <Meter value={taken} target={Math.max(1, supplements.length)} color={SERIES_COLORS[2]} />
          </div>

          {[...grouped.entries()].map(([timing, items]) => (
            <div key={timing} style={{ marginBottom: 10 }}>
              <div className="nav-group-label" style={{ padding: '4px 0 2px' }}>
                {TIMING_LABEL[timing] ?? timing}
              </div>
              {items.map((s) => (
                <label className="checkbox-row" key={s.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(s.taken)}
                    disabled={busy}
                    onChange={(e) =>
                      send({ action: 'toggle_supplement', supplementId: s.id, taken: e.target.checked })
                    }
                  />
                  <span>
                    <span className="strong">{s.name}</span>
                    <span className="muted small">
                      {' '}
                      · {s.dose} {s.unit}
                    </span>
                    {s.purpose ? <div className="small muted">{s.purpose}</div> : null}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </Card>

        <Card title="Recovery protocols" note={`Logged for ${day}`}>
          <div className="control-bar">
            {PROTOCOL_KINDS.map((p) => (
              <button
                key={p.kind}
                className="btn btn-sm"
                type="button"
                disabled={busy}
                onClick={() =>
                  send({
                    action: 'log_protocol',
                    kind: p.kind,
                    minutes: p.defaultMinutes,
                    intensity: p.defaultIntensity,
                  })
                }
              >
                + {p.label}
              </button>
            ))}
          </div>

          <div className="scroll-x" style={{ marginBottom: 14 }}>
            {protocols.length ? (
              <table>
                <tbody>
                  {protocols.map((p) => (
                    <tr key={p.id}>
                      <td className="strong" style={{ textTransform: 'capitalize' }}>
                        {p.kind.replace(/_/g, ' ')}
                      </td>
                      <td className="num">{Math.round(p.minutes)} min</td>
                      <td className="muted small">{p.intensity ?? ''}</td>
                      <td style={{ width: 30 }}>
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={busy}
                          onClick={() => send({ action: 'delete_protocol', id: p.id })}
                          aria-label={`Remove ${p.kind}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">Nothing logged for this day.</div>
            )}
          </div>

          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              Log with custom duration
            </summary>
            <div className="control-bar" style={{ marginTop: 10 }}>
              <select value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value })}>
                {PROTOCOL_KINDS.map((p) => (
                  <option key={p.kind} value={p.kind}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={custom.minutes}
                onChange={(e) => setCustom({ ...custom, minutes: Number(e.target.value) || 1 })}
                style={{ width: 80 }}
                aria-label="Minutes"
              />
              <input
                type="text"
                placeholder="Intensity"
                value={custom.intensity}
                onChange={(e) => setCustom({ ...custom, intensity: e.target.value })}
                style={{ width: 120 }}
              />
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={busy}
                onClick={() =>
                  send({
                    action: 'log_protocol',
                    kind: custom.kind,
                    minutes: custom.minutes,
                    intensity: custom.intensity,
                    notes: custom.notes,
                  })
                }
              >
                Log
              </button>
            </div>
          </details>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Protocol usage · 30 days">
          {protocolTotals.length ? (
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Protocol</th>
                    <th className="num">Sessions</th>
                    <th className="num">Total</th>
                    <th className="num">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {protocolTotals.map((t) => (
                    <tr key={t.kind}>
                      <td className="strong" style={{ textTransform: 'capitalize' }}>
                        {t.kind.replace(/_/g, ' ')}
                      </td>
                      <td className="num">{t.sessions}</td>
                      <td className="num">{Math.round(t.minutes)} min</td>
                      <td className="num muted">{Math.round(t.minutes / t.sessions)} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No protocols logged in the last 30 days.</div>
          )}

          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 8 }}>Adherence by item</h3>
            <div className="scroll-x">
              <table>
                <tbody>
                  {adherence.map((a) => (
                    <tr key={a.id}>
                      <td className="strong">{a.name}</td>
                      <td style={{ width: '45%' }}>
                        <Meter
                          value={a.pct}
                          target={100}
                          color={a.pct >= 85 ? 'var(--good)' : a.pct >= 60 ? 'var(--warning)' : 'var(--serious)'}
                        />
                      </td>
                      <td className="num">{a.pct}%</td>
                      <td className="num muted">
                        {a.taken}/{a.due}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <Card title="Sleep efficiency" note="Asleep time as a share of time in bed, last 90 nights">
          <MetricChart
            series={{ metric: 'sleep.efficiency', label: 'Efficiency', unit: '%', points: efficiencyPoints }}
            shape="line"
            color={SERIES_COLORS[5]}
            dp={1}
            height={260}
          />
        </Card>
      </div>
    </>
  );
}

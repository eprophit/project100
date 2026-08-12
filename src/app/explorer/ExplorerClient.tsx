'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartLegend, OverlayChart, SmallMultiples, type OverlaySeries } from '@/components/charts';
import { MAX_SERIES, SERIES_COLORS } from '@/lib/palette';
import { Card } from '@/components/ui';

interface MetricMeta {
  id: string;
  label: string;
  unit: string;
  domain: string;
  better: string;
  shape: string;
  description: string;
  dp: number;
}

interface ApiSeries extends MetricMeta {
  points: { day: string; value: number }[];
  rawPoints: { day: string; value: number }[];
}

interface Correlation {
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  sameDay: { r: number; n: number; strength: string };
  best: { r: number; n: number; lagDays: number; strength: string };
}

const RANGES = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: '1y', days: 365 },
];

const SMOOTHING = [
  { label: 'Raw', value: 1 },
  { label: '7d', value: 7 },
  { label: '28d', value: 28 },
];

const PRESETS: { label: string; ids: string[]; smooth: number }[] = [
  {
    label: 'Load vs recovery',
    ids: ['training.acute', 'recovery.hrv', 'recovery.readiness'],
    smooth: 7,
  },
  { label: 'Sleep vs HRV', ids: ['sleep.duration', 'sleep.deep', 'recovery.hrv'], smooth: 7 },
  { label: 'Fuel vs training', ids: ['nutrition.kcal', 'nutrition.carbs', 'training.load'], smooth: 7 },
  { label: 'Aerobic progress', ids: ['row.pace', 'bike.watts', 'body.vo2max'], smooth: 28 },
  { label: 'Body composition', ids: ['body.weight', 'body.bodyfat', 'body.lean'], smooth: 7 },
];

export function ExplorerClient({ metrics }: { metrics: MetricMeta[] }) {
  const [selected, setSelected] = useState<string[]>(PRESETS[0].ids);
  const [days, setDays] = useState(180);
  const [smoothWindow, setSmoothWindow] = useState(7);
  const [mode, setMode] = useState<'overlay' | 'multiples'>('overlay');
  const [filter, setFilter] = useState('');
  const [series, setSeries] = useState<ApiSeries[]>([]);
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [loading, setLoading] = useState(false);

  const byDomain = useMemo(() => {
    const groups = new Map<string, MetricMeta[]>();
    const q = filter.trim().toLowerCase();
    for (const m of metrics) {
      if (q && !m.label.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) continue;
      const list = groups.get(m.domain) ?? [];
      list.push(m);
      groups.set(m.domain, list);
    }
    return [...groups.entries()];
  }, [metrics, filter]);

  const load = useCallback(async () => {
    if (!selected.length) {
      setSeries([]);
      setCorrelations([]);
      return;
    }
    setLoading(true);
    try {
      const to = new Date().toISOString().slice(0, 10);
      const fromDate = new Date();
      fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
      const from = fromDate.toISOString().slice(0, 10);

      const params = new URLSearchParams({
        ids: selected.join(','),
        from,
        to,
        smooth: String(smoothWindow),
        normalize: '1',
        correlate: '1',
      });
      const res = await fetch(`/api/metrics?${params}`);
      const data = await res.json();
      setSeries(data.series ?? []);
      setCorrelations(data.correlations ?? []);
    } finally {
      setLoading(false);
    }
  }, [selected, days, smoothWindow]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SERIES) return prev; // never invent a ninth hue
      return [...prev, id];
    });
  };

  // Colour follows the entity's position in the selection, not its rank in the
  // data — deselecting a series must not repaint the survivors.
  const colored: OverlaySeries[] = useMemo(
    () =>
      series.map((s) => ({
        id: s.id,
        label: s.label,
        unit: s.unit,
        dp: s.dp,
        color: SERIES_COLORS[Math.max(0, selected.indexOf(s.id)) % SERIES_COLORS.length],
        points: s.points,
        rawPoints: s.rawPoints,
      })),
    [series, selected],
  );

  const units = new Set(series.map((s) => s.unit));
  const sameUnit = units.size === 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Explorer</h1>
          <p className="page-sub">
            Overlay any metrics from any source on one timeline, and check whether they actually move together.
          </p>
        </div>
      </div>

      <div className="stack">
        <Card>
          <div className="control-bar" style={{ marginBottom: 12 }}>
            <div className="segmented">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setDays(r.days)}
                  aria-pressed={days === r.days}
                  type="button"
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="segmented">
              {SMOOTHING.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setSmoothWindow(s.value)}
                  aria-pressed={smoothWindow === s.value}
                  type="button"
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="segmented">
              <button onClick={() => setMode('overlay')} aria-pressed={mode === 'overlay'} type="button">
                Overlay
              </button>
              <button onClick={() => setMode('multiples')} aria-pressed={mode === 'multiples'} type="button">
                Small multiples
              </button>
            </div>

            <div className="spacer" />
            {loading ? <span className="spin" aria-label="Loading" /> : null}
            <span className="small muted">
              {selected.length}/{MAX_SERIES} series
            </span>
          </div>

          <div className="control-bar" style={{ marginBottom: 12 }}>
            <span className="small muted">Presets:</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className="btn btn-sm"
                type="button"
                onClick={() => {
                  setSelected(p.ids);
                  setSmoothWindow(p.smooth);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {mode === 'overlay' ? (
            <>
              <ChartLegend
                items={colored.map((s) => ({
                  label: s.label,
                  color: s.color,
                  value: s.rawPoints?.length
                    ? `${s.rawPoints[s.rawPoints.length - 1].value} ${s.unit}`
                    : undefined,
                }))}
              />
              <OverlayChart series={colored} normalized={!sameUnit} height={340} />
              <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                {sameUnit
                  ? `All selected metrics share the unit “${[...units][0]}”, so they are plotted at their real values on one axis.`
                  : 'Units differ, so each series is standardised to its own mean and standard deviation over the window (z-score). ' +
                    'A value of +1 means one standard deviation above that metric’s own average — this is what lets different units share one axis instead of adding a second. ' +
                    'Hover to read the real values.'}
              </p>
            </>
          ) : (
            <SmallMultiples series={colored} />
          )}
        </Card>

        <div className="grid grid-2">
          <Card
            title="Metrics"
            note="Pick up to eight. Everything is keyed on the same day index, so any two can be compared."
          >
            <input
              type="search"
              placeholder="Filter metrics…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: '100%', marginBottom: 10 }}
            />
            <div className="metric-picker">
              {byDomain.map(([domain, items]) => (
                <div key={domain} style={{ gridColumn: '1 / -1' }}>
                  <div className="nav-group-label" style={{ padding: '8px 4px 2px' }}>
                    {domain}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
                    {items.map((m) => {
                      const idx = selected.indexOf(m.id);
                      const active = idx >= 0;
                      return (
                        <label className="checkbox-row" key={m.id} title={m.description}>
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggle(m.id)}
                            disabled={!active && selected.length >= MAX_SERIES}
                          />
                          {active ? (
                            <span
                              className="dot"
                              style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }}
                            />
                          ) : null}
                          <span className="small">{m.label}</span>
                          <span className="spacer" />
                          <span className="small muted">{m.unit}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Relationships"
            note="Pearson r over the selected window. Positive lag means the first metric tracks the second from N days earlier."
          >
            {correlations.length === 0 ? (
              <div className="empty">Select at least two metrics to compare them.</div>
            ) : (
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Pair</th>
                      <th className="num">Same-day r</th>
                      <th className="num">Best r</th>
                      <th className="num">Lag</th>
                      <th className="num">n</th>
                      <th>Strength</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...correlations]
                      .sort((a, b) => Math.abs(b.best.r) - Math.abs(a.best.r))
                      .map((c) => (
                        <tr key={`${c.a}|${c.b}`}>
                          <td className="strong">
                            {c.aLabel} <span className="muted">vs</span> {c.bLabel}
                          </td>
                          <td className="num">{c.sameDay.r.toFixed(2)}</td>
                          <td className="num strong">{c.best.r.toFixed(2)}</td>
                          <td className="num">{c.best.lagDays > 0 ? `+${c.best.lagDays}` : c.best.lagDays}d</td>
                          <td className="num">{c.best.n}</td>
                          <td>
                            <span
                              className={`badge ${
                                c.best.strength === 'strong'
                                  ? 'badge-good'
                                  : c.best.strength === 'moderate'
                                    ? 'badge-warning'
                                    : ''
                              }`}
                            >
                              {c.best.strength}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
              These are observational correlations on a single person’s self-tracked data. Training phase and
              season move most of these signals together, so a strong r is a prompt to investigate, not evidence
              of cause.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

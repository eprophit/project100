import { MetricChart } from '@/components/charts';
import { SERIES_COLORS } from '@/lib/palette';
import { Card, RangeBar, StatTile, StatusBadge } from '@/components/ui';
import { ensureReady } from '@/lib/bootstrap';
import { formatDay } from '@/lib/dates';
import { biomarkerDeltas, biomarkerHistory, latestPanel, panelDays } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function LabsPage({
  searchParams,
}: {
  searchParams: Promise<{ marker?: string }>;
}) {
  await ensureReady();

  const params = await searchParams;
  const panel = latestPanel();
  const days = panelDays();
  const deltas = biomarkerDeltas();
  const deltaBySlug = new Map(deltas.map((d) => [d.slug, d]));

  const selectedSlug = params.marker ?? panel.markers[0]?.slug;
  const history = selectedSlug ? biomarkerHistory(selectedSlug) : [];
  const selected = history.at(-1);

  const categories = [...new Set(panel.markers.map((m) => m.category))];
  const counts = {
    optimal: panel.markers.filter((m) => m.status === 'optimal').length,
    inRange: panel.markers.filter((m) => m.status === 'in_range').length,
    out: panel.markers.filter((m) => m.status === 'out_of_range').length,
  };

  if (!panel.day) {
    return (
      <>
        <div className="page-head">
          <h1>Biomarkers</h1>
        </div>
        <Card>
          <div className="empty">No panels on file. Sync Function Health from Connections.</div>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Biomarkers</h1>
          <p className="page-sub">
            Function Health · {days.length} panels · latest {formatDay(panel.day, { year: true })}
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-4">
          <StatTile label="Markers tracked" value={panel.markers.length} meta={`${categories.length} categories`} />
          <StatTile label="Optimal" value={counts.optimal} tone="good" meta="Inside the tighter optimal band" />
          <StatTile label="In range" value={counts.inRange} meta="Clinically normal, not yet optimal" />
          <StatTile
            label="Out of range"
            value={counts.out}
            tone={counts.out ? 'critical' : undefined}
            meta="Outside the clinical reference range"
          />
        </div>

        <Card
          title={selected ? `${selected.name} over time` : 'Marker history'}
          note={
            selected
              ? `${selected.unit ?? ''}${
                  selected.optimal_low != null || selected.optimal_high != null
                    ? ` · optimal ${selected.optimal_low ?? '≤'}–${selected.optimal_high ?? '+'}`
                    : ''
                }`
              : undefined
          }
        >
          {history.length > 1 ? (
            <MetricChart
              series={{
                metric: selectedSlug!,
                label: selected?.name ?? '',
                unit: selected?.unit ?? '',
                points: history.map((h) => ({ day: h.day, value: h.value })),
              }}
              shape="line"
              color={SERIES_COLORS[0]}
              dp={2}
              height={230}
              referenceBand={
                selected?.optimal_low != null && selected?.optimal_high != null
                  ? { from: selected.optimal_low, to: selected.optimal_high }
                  : undefined
              }
            />
          ) : (
            <div className="empty">Only one reading on file for this marker.</div>
          )}
          <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
            The shaded band is the optimal range. Values are for tracking trends — anything outside the reference
            range belongs in a conversation with your clinician, not this app.
          </p>
        </Card>

        {categories.map((category) => (
          <Card key={category} title={category} note={`${panel.markers.filter((m) => m.category === category).length} markers`}>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Marker</th>
                    <th className="num">Value</th>
                    <th style={{ width: '26%' }}>Position in range</th>
                    <th className="num">Reference</th>
                    <th className="num">Since first panel</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.markers
                    .filter((m) => m.category === category)
                    .map((m) => {
                      const d = deltaBySlug.get(m.slug);
                      const pct = d && d.first_v ? ((d.last_v - d.first_v) / Math.abs(d.first_v)) * 100 : null;
                      return (
                        <tr key={m.slug}>
                          <td>
                            <a href={`/labs?marker=${m.slug}`} className="strong" style={{ textDecoration: selectedSlug === m.slug ? 'underline' : undefined }}>
                              {m.name}
                            </a>
                          </td>
                          <td className="num strong">
                            {m.value} <span className="muted">{m.unit}</span>
                          </td>
                          <td>
                            <RangeBar
                              value={m.value}
                              refLow={m.ref_low}
                              refHigh={m.ref_high}
                              optLow={m.optimal_low}
                              optHigh={m.optimal_high}
                              status={m.status}
                            />
                          </td>
                          <td className="num muted">
                            {m.ref_low ?? '—'}–{m.ref_high ?? '—'}
                          </td>
                          <td className="num" style={{ color: pct == null ? undefined : 'var(--text-secondary)' }}>
                            {pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`}
                          </td>
                          <td>
                            <StatusBadge status={m.status} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

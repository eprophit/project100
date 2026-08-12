import Link from 'next/link';
import { ChartLegend, MetricChart, OverlayChart, Sparkline } from '@/components/charts';
import { SERIES_COLORS } from '@/lib/palette';
import { Card, Meter, StatTile, StatusBadge } from '@/components/ui';
import { ensureReady } from '@/lib/bootstrap';
import { addDays, formatDay, formatDuration, formatPace, today } from '@/lib/dates';
import { getSeries } from '@/lib/metrics';
import {
  acwr,
  biomarkerDeltas,
  latestPanel,
  nutritionDay,
  protocolsForDay,
  recentWorkouts,
  supplementsForDay,
  todayCard,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await ensureReady();

  const day = today();
  const card = todayCard(day);
  const ratio = acwr(day);
  const nutrition = nutritionDay(day);
  const supplements = supplementsForDay(day);
  const protocols = protocolsForDay(day);
  const sessions = recentWorkouts(6);
  const panel = latestPanel();
  const deltas = biomarkerDeltas();

  const from90 = addDays(day, -89);
  const hrv = getSeries('recovery.hrv', from90, day);
  const acute = getSeries('training.acute', from90, day);
  const chronic = getSeries('training.chronic', from90, day);
  const sleep = getSeries('sleep.duration', addDays(day, -29), day);
  const readiness = getSeries('recovery.readiness', addDays(day, -29), day);
  const weight = getSeries('body.weight', from90, day);

  const hrvDelta =
    card.hrv && card.hrvBaseline ? Math.round(((card.hrv - card.hrvBaseline) / card.hrvBaseline) * 1000) / 10 : null;

  const outOfRange = panel.markers.filter((m) => m.status === 'out_of_range');
  const optimal = panel.markers.filter((m) => m.status === 'optimal');

  const readinessTone =
    card.readiness == null ? undefined : card.readiness >= 70 ? 'good' : card.readiness >= 50 ? 'warning' : 'critical';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p className="page-sub">{formatDay(day, { year: true })} · all six sources synced</p>
        </div>
        <Link href="/coach" className="btn btn-primary">
          ✦ Ask the coach
        </Link>
      </div>

      <div className="stack">
        <div className="grid grid-4">
          <StatTile
            label="Readiness"
            value={card.readiness}
            unit="/100"
            tone={readinessTone}
            meta={ratio.ratio != null ? `ACWR ${ratio.ratio} · ${ratio.verdict}` : 'Building baseline'}
          >
            {readiness.points.length ? (
              <div style={{ marginTop: 8 }}>
                <Sparkline points={readiness.points} color={SERIES_COLORS[2]} />
              </div>
            ) : null}
          </StatTile>

          <StatTile
            label="HRV (rMSSD)"
            value={card.hrv}
            unit="ms"
            meta={
              hrvDelta == null ? (
                'No baseline yet'
              ) : (
                <>
                  {hrvDelta > 0 ? '▲' : '▼'} {Math.abs(hrvDelta)}% vs 60-day baseline of {card.hrvBaseline} ms
                </>
              )
            }
          >
            {hrv.points.length ? (
              <div style={{ marginTop: 8 }}>
                <Sparkline points={hrv.points.slice(-30)} color={SERIES_COLORS[0]} />
              </div>
            ) : null}
          </StatTile>

          <StatTile
            label="Sleep"
            value={card.sleepHours}
            unit="h"
            meta={`Resting HR ${card.restingHr ?? '—'} bpm`}
          >
            {sleep.points.length ? (
              <div style={{ marginTop: 8 }}>
                <Sparkline points={sleep.points} color={SERIES_COLORS[6]} />
              </div>
            ) : null}
          </StatTile>

          <StatTile
            label="Body weight"
            value={card.weight}
            unit="kg"
            meta={
              weight.points.length > 30
                ? `${(card.weight! - weight.points[0].value).toFixed(1)} kg over 90 days`
                : undefined
            }
          >
            {weight.points.length ? (
              <div style={{ marginTop: 8 }}>
                <Sparkline points={weight.points} color={SERIES_COLORS[4]} />
              </div>
            ) : null}
          </StatTile>
        </div>

        <div className="grid grid-2">
          <Card
            title="Training load balance"
            note="Acute (7-day) against chronic (28-day). Two metrics, one unit, one axis."
          >
            <LoadChart acute={acute} chronic={chronic} />
          </Card>

          <Card title="Heart-rate variability" note="Last 90 days, morning readings from HRV4Training">
            <MetricChart series={hrv} shape="area" color={SERIES_COLORS[0]} dp={1} height={220} />
          </Card>
        </div>

        <div className="grid grid-2">
          <Card title="Today's fuel" note={`Target ${nutrition.targets.kcal.toLocaleString()} kcal`}>
            <div className="stack" style={{ gap: 12 }}>
              <MacroRow
                label="Energy"
                value={nutrition.totals.kcal}
                target={nutrition.targets.kcal}
                unit="kcal"
                color={SERIES_COLORS[3]}
              />
              <MacroRow
                label="Protein"
                value={nutrition.totals.protein_g}
                target={nutrition.targets.protein_g}
                unit="g"
                color={SERIES_COLORS[0]}
              />
              <MacroRow
                label="Carbs"
                value={nutrition.totals.carbs_g}
                target={nutrition.targets.carbs_g}
                unit="g"
                color={SERIES_COLORS[2]}
              />
              <MacroRow
                label="Fat"
                value={nutrition.totals.fat_g}
                target={nutrition.targets.fat_g}
                unit="g"
                color={SERIES_COLORS[1]}
              />
              <MacroRow
                label="Fibre"
                value={nutrition.totals.fiber_g}
                target={nutrition.targets.fiber_g}
                unit="g"
                color={SERIES_COLORS[5]}
              />
              <Link href="/nutrition" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
                Open food log →
              </Link>
            </div>
          </Card>

          <Card title="Recovery inputs" note={`${card.protocolMinutes} min of protocols logged today`}>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 6 }}>
                {protocols.length ? (
                  protocols.map((p) => (
                    <span className="badge" key={p.id}>
                      {p.kind.replace(/_/g, ' ')} · {Math.round(p.minutes)}m
                    </span>
                  ))
                ) : (
                  <span className="muted small">Nothing logged yet today.</span>
                )}
              </div>

              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">Supplement stack</span>
                <span className="small strong">
                  {card.supplementsTaken}/{card.supplementsDue} taken
                </span>
              </div>
              <Meter
                value={card.supplementsTaken}
                target={Math.max(1, card.supplementsDue)}
                color={SERIES_COLORS[2]}
              />

              <div className="scroll-x">
                <table>
                  <tbody>
                    {supplements.slice(0, 6).map((s) => (
                      <tr key={s.id}>
                        <td className="strong">{s.name}</td>
                        <td className="muted small nowrap">
                          {s.dose} {s.unit}
                        </td>
                        <td style={{ width: 34, textAlign: 'right' }}>
                          {s.taken ? (
                            <span style={{ color: 'var(--good)' }}>✓</span>
                          ) : (
                            <span className="muted">○</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Link href="/recovery" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
                Open recovery log →
              </Link>
            </div>
          </Card>
        </div>

        <div className="grid grid-2">
          <Card title="Recent sessions" action={<Link href="/training" className="btn btn-sm">All training</Link>}>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Session</th>
                    <th className="num">Time</th>
                    <th className="num">Key</th>
                    <th className="num">Load</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((w) => (
                    <tr key={w.id}>
                      <td className="nowrap muted">{formatDay(w.day)}</td>
                      <td>
                        <span className="strong">{w.title ?? w.modality}</span>
                        <div className="small muted">{w.modality}</div>
                      </td>
                      <td className="num">{formatDuration(w.duration_s)}</td>
                      <td className="num">
                        {w.modality === 'rowing' && w.pace_s
                          ? `${formatPace(w.pace_s)}/500m`
                          : w.modality === 'running' && w.pace_s
                            ? `${formatPace(w.pace_s)}/km`
                            : w.avg_watts
                              ? `${Math.round(w.avg_watts)} W`
                              : w.distance_m
                                ? `${(w.distance_m / 1000).toFixed(1)} km`
                                : '—'}
                      </td>
                      <td className="num">{Math.round(w.load)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Latest biomarker panel"
            note={panel.day ? formatDay(panel.day, { year: true }) : 'No panel on file'}
            action={<Link href="/labs" className="btn btn-sm">All markers</Link>}
          >
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="badge badge-good">
                <span aria-hidden>●</span> {optimal.length} optimal
              </span>
              <span className="badge">
                <span aria-hidden>○</span> {panel.markers.length - optimal.length - outOfRange.length} in range
              </span>
              <span className={`badge ${outOfRange.length ? 'badge-critical' : ''}`}>
                <span aria-hidden>▲</span> {outOfRange.length} out of range
              </span>
            </div>

            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Marker</th>
                    <th className="num">First</th>
                    <th className="num">Latest</th>
                    <th className="num">Change</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deltas
                    .map((d) => ({
                      ...d,
                      pct: d.first_v ? ((d.last_v - d.first_v) / Math.abs(d.first_v)) * 100 : 0,
                    }))
                    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
                    .slice(0, 6)
                    .map((d) => (
                      <tr key={d.slug}>
                        <td className="strong">{d.name}</td>
                        <td className="num">{d.first_v}</td>
                        <td className="num">{d.last_v}</td>
                        <td className="num">
                          {d.pct > 0 ? '+' : ''}
                          {d.pct.toFixed(0)}%
                        </td>
                        <td>
                          <StatusBadge status={d.status} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function MacroRow({
  label,
  value,
  target,
  unit,
  color,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  color: string;
}) {
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="small">{label}</span>
        <span className="small mono">
          {Math.round(value).toLocaleString()} / {Math.round(target).toLocaleString()} {unit}
        </span>
      </div>
      <Meter value={value} target={target} color={color} />
    </div>
  );
}

/** Acute and chronic share a unit, so they legitimately share one axis. */
function LoadChart({
  acute,
  chronic,
}: {
  acute: ReturnType<typeof getSeries>;
  chronic: ReturnType<typeof getSeries>;
}) {
  const series = [
    { id: 'acute', label: 'Acute (7d)', unit: 'au', dp: 1, color: SERIES_COLORS[1], points: acute.points },
    { id: 'chronic', label: 'Chronic (28d)', unit: 'au', dp: 1, color: SERIES_COLORS[0], points: chronic.points },
  ];

  return (
    <>
      <ChartLegend
        items={series.map((s) => ({
          label: s.label,
          color: s.color,
          value: s.points.length ? `${s.points[s.points.length - 1].value}` : undefined,
        }))}
      />
      <OverlayChart series={series} normalized={false} height={220} />
    </>
  );
}

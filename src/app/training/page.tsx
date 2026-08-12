import { ChartLegend, MetricChart, OverlayChart } from '@/components/charts';
import { SERIES_COLORS } from '@/lib/palette';
import { Card, StatTile } from '@/components/ui';
import { ensureReady } from '@/lib/bootstrap';
import { addDays, formatDay, formatDuration, formatPace, today } from '@/lib/dates';
import { getSeries } from '@/lib/metrics';
import { acwr, liftProgress, modalitySummaries, recentWorkouts } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const MODALITY_COLOR: Record<string, string> = {
  rowing: SERIES_COLORS[0],
  cycling: SERIES_COLORS[1],
  running: SERIES_COLORS[2],
  strength: SERIES_COLORS[3],
  walking: SERIES_COLORS[4],
  mobility: SERIES_COLORS[5],
  swimming: SERIES_COLORS[6],
};

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await ensureReady();

  const params = await searchParams;
  const days = Math.min(365, Math.max(14, Number(params.days) || 90));
  const to = today();
  const from = addDays(to, -(days - 1));

  const summaries = modalitySummaries(from, to);
  const sessions = recentWorkouts(30, from, to);
  const ratio = acwr(to);

  const rowPace = getSeries('row.pace', from, to);
  const bikeWatts = getSeries('bike.watts', from, to);
  const runPace = getSeries('run.pace', from, to);
  const volume = getSeries('strength.volume', from, to);
  const acute = getSeries('training.acute', from, to);
  const chronic = getSeries('training.chronic', from, to);

  const lifts = liftProgress(from, to);
  const liftNames = [...new Set(lifts.map((l) => l.exercise))].slice(0, SERIES_COLORS.length);
  const liftSeries = liftNames.map((name, i) => ({
    id: name,
    label: name,
    unit: 'kg',
    dp: 1,
    color: SERIES_COLORS[i],
    points: lifts.filter((l) => l.exercise === name).map((l) => ({ day: l.day, value: Math.round(l.e1rm * 10) / 10 })),
  }));

  const totals = summaries.reduce(
    (acc, m) => ({
      sessions: acc.sessions + m.sessions,
      minutes: acc.minutes + m.minutes,
      km: acc.km + m.distanceKm,
      load: acc.load + m.load,
    }),
    { sessions: 0, minutes: 0, km: 0, load: 0 },
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Training</h1>
          <p className="page-sub">
            {formatDay(from)} – {formatDay(to, { year: true })} · rowing from ErgData, cycling from Peloton,
            everything else from Apple Health
          </p>
        </div>
        <div className="segmented">
          {[30, 90, 180, 365].map((d) => (
            <a key={d} href={`/training?days=${d}`} className="btn btn-sm" aria-pressed={days === d}
               style={days === d ? { background: 'var(--surface-3)', color: 'var(--text-primary)' } : undefined}>
              {d === 365 ? '1y' : `${d}d`}
            </a>
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-4">
          <StatTile label="Sessions" value={totals.sessions} meta={`${summaries.length} modalities`} />
          <StatTile label="Training time" value={Math.round(totals.minutes / 60)} unit="h" meta={`${totals.minutes.toLocaleString()} minutes`} />
          <StatTile label="Distance" value={Math.round(totals.km)} unit="km" meta="All modalities combined" />
          <StatTile
            label="Acute : chronic"
            value={ratio.ratio ?? '—'}
            tone={ratio.ratio == null ? undefined : ratio.ratio > 1.3 ? 'warning' : ratio.ratio < 0.8 ? 'serious' : 'good'}
            meta={ratio.verdict}
          />
        </div>

        <Card title="Progress by modality" note="Each modality tracked on the measure that actually matters for it">
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Modality</th>
                  <th className="num">Sessions</th>
                  <th className="num">Time</th>
                  <th className="num">Distance</th>
                  <th className="num">Load</th>
                  <th className="num">Avg HR</th>
                  <th>Best effort</th>
                  <th className="num">Load trend</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((m) => (
                  <tr key={m.modality}>
                    <td>
                      <span className="row-tight">
                        <span className="dot" style={{ background: MODALITY_COLOR[m.modality] ?? SERIES_COLORS[7] }} />
                        <span className="strong" style={{ textTransform: 'capitalize' }}>
                          {m.modality}
                        </span>
                      </span>
                    </td>
                    <td className="num">{m.sessions}</td>
                    <td className="num">{Math.round(m.minutes / 60)}h {m.minutes % 60}m</td>
                    <td className="num">{m.distanceKm ? `${m.distanceKm} km` : '—'}</td>
                    <td className="num">{m.load.toLocaleString()}</td>
                    <td className="num">{m.avgHr ?? '—'}</td>
                    <td>
                      {m.best ? (
                        <>
                          <span className="strong">{m.best.value}</span>
                          <span className="muted small"> · {m.best.label}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num" style={{ color: m.trendPct == null ? undefined : m.trendPct >= 0 ? 'var(--good)' : 'var(--serious)' }}>
                      {m.trendPct == null ? '—' : `${m.trendPct > 0 ? '+' : ''}${m.trendPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid grid-2">
          <Card title="Rowing split" note="Average seconds per 500 m — the axis is inverted so up means faster">
            <MetricChart series={rowPace} shape="scatter" color={SERIES_COLORS[0]} dp={1} invertY height={210} />
          </Card>
          <Card title="Cycling power" note="Average watts per ride">
            <MetricChart series={bikeWatts} shape="scatter" color={SERIES_COLORS[1]} dp={0} height={210} />
          </Card>
          <Card title="Running pace" note="Average seconds per kilometre — axis inverted so up means faster">
            <MetricChart series={runPace} shape="scatter" color={SERIES_COLORS[2]} dp={0} invertY height={210} />
          </Card>
          <Card title="Lifting volume" note="Tonnage per session (reps × load)">
            <MetricChart series={volume} shape="bar" color={SERIES_COLORS[3]} dp={0} height={210} />
          </Card>
        </div>

        <div className="grid grid-2">
          <Card title="Estimated 1RM by lift" note="Epley estimate from the day's top set">
            <ChartLegend items={liftSeries.map((s) => ({ label: s.label, color: s.color }))} />
            <OverlayChart series={liftSeries} normalized={false} height={260} connectGaps />
          </Card>

          <Card title="Load balance" note="Acute (7d) vs chronic (28d), same unit and one axis">
            <ChartLegend
              items={[
                { label: 'Acute (7d)', color: SERIES_COLORS[1], value: `${acute.points.at(-1)?.value ?? '—'}` },
                { label: 'Chronic (28d)', color: SERIES_COLORS[0], value: `${chronic.points.at(-1)?.value ?? '—'}` },
              ]}
            />
            <OverlayChart
              series={[
                { id: 'acute', label: 'Acute (7d)', unit: 'au', dp: 1, color: SERIES_COLORS[1], points: acute.points },
                { id: 'chronic', label: 'Chronic (28d)', unit: 'au', dp: 1, color: SERIES_COLORS[0], points: chronic.points },
              ]}
              normalized={false}
              height={260}
            />
          </Card>
        </div>

        <Card title="Session log" note={`${sessions.length} most recent sessions in range`}>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Modality</th>
                  <th>Session</th>
                  <th className="num">Time</th>
                  <th className="num">Distance</th>
                  <th className="num">Pace / power</th>
                  <th className="num">Avg HR</th>
                  <th className="num">kcal</th>
                  <th className="num">Load</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((w) => (
                  <tr key={w.id}>
                    <td className="nowrap muted">{formatDay(w.day)}</td>
                    <td>
                      <span className="row-tight">
                        <span className="dot" style={{ background: MODALITY_COLOR[w.modality] ?? SERIES_COLORS[7] }} />
                        <span style={{ textTransform: 'capitalize' }}>{w.modality}</span>
                      </span>
                    </td>
                    <td className="strong">{w.title ?? '—'}</td>
                    <td className="num">{formatDuration(w.duration_s)}</td>
                    <td className="num">{w.distance_m ? `${(w.distance_m / 1000).toFixed(2)} km` : '—'}</td>
                    <td className="num">
                      {w.modality === 'rowing' && w.pace_s
                        ? `${formatPace(w.pace_s)}/500m`
                        : w.modality === 'running' && w.pace_s
                          ? `${formatPace(w.pace_s)}/km`
                          : w.avg_watts
                            ? `${Math.round(w.avg_watts)} W`
                            : '—'}
                    </td>
                    <td className="num">{w.avg_hr ? Math.round(w.avg_hr) : '—'}</td>
                    <td className="num">{w.kcal ? Math.round(w.kcal) : '—'}</td>
                    <td className="num">{Math.round(w.load)}</td>
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

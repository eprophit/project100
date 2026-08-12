import { RecoveryClient } from './RecoveryClient';
import { ChartLegend, MetricChart, OverlayChart } from '@/components/charts';
import { SERIES_COLORS } from '@/lib/palette';
import { Card, StatTile } from '@/components/ui';
import { ensureReady } from '@/lib/bootstrap';
import { addDays, today } from '@/lib/dates';
import { getSeries } from '@/lib/metrics';
import { protocolTotals, protocolsForDay, supplementAdherence, supplementsForDay, todayCard } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function RecoveryPage() {
  await ensureReady();

  const day = today();
  const from = addDays(day, -29);
  const from90 = addDays(day, -89);

  const card = todayCard(day);
  const supplements = supplementsForDay(day);
  const protocols = protocolsForDay(day);
  const totals = protocolTotals(from, day);
  const adherence = supplementAdherence(from, day);

  const duration = getSeries('sleep.duration', from90, day);
  const deep = getSeries('sleep.deep', from90, day);
  const rem = getSeries('sleep.rem', from90, day);
  const efficiency = getSeries('sleep.efficiency', from90, day);
  const rhr = getSeries('recovery.rhr', from90, day);
  const readiness = getSeries('recovery.readiness', from90, day);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recovery</h1>
          <p className="page-sub">
            Sleep from Apple Health, morning HRV from HRV4Training, protocols and supplements logged here.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-4">
          <StatTile
            label="Readiness"
            value={card.readiness}
            unit="/100"
            tone={card.readiness == null ? undefined : card.readiness >= 70 ? 'good' : card.readiness >= 50 ? 'warning' : 'critical'}
          />
          <StatTile label="Sleep last night" value={card.sleepHours} unit="h" meta={`Resting HR ${card.restingHr ?? '—'} bpm`} />
          <StatTile
            label="Protocol minutes · 30d"
            value={totals.reduce((s, t) => s + Math.round(t.minutes), 0)}
            unit="min"
            meta={`${totals.reduce((s, t) => s + t.sessions, 0)} sessions`}
          />
          <StatTile
            label="Supplement adherence · 30d"
            value={
              adherence.length
                ? Math.round(adherence.reduce((s, a) => s + a.pct, 0) / adherence.length)
                : null
            }
            unit="%"
            tone={
              adherence.length && adherence.reduce((s, a) => s + a.pct, 0) / adherence.length >= 85
                ? 'good'
                : 'warning'
            }
            meta={`${adherence.length} active items`}
          />
        </div>

        <div className="grid grid-2">
          <Card title="Sleep architecture" note="Deep and REM minutes, last 90 nights — same unit, one axis">
            <ChartLegend
              items={[
                { label: 'Deep', color: SERIES_COLORS[0], value: `${deep.points.at(-1)?.value ?? '—'} min` },
                { label: 'REM', color: SERIES_COLORS[6], value: `${rem.points.at(-1)?.value ?? '—'} min` },
              ]}
            />
            <OverlayChart
              series={[
                { id: 'deep', label: 'Deep', unit: 'min', dp: 0, color: SERIES_COLORS[0], points: deep.points },
                { id: 'rem', label: 'REM', unit: 'min', dp: 0, color: SERIES_COLORS[6], points: rem.points },
              ]}
              normalized={false}
              height={220}
            />
          </Card>

          <Card title="Sleep duration" note="Hours asleep, last 90 nights">
            <MetricChart series={duration} shape="area" color={SERIES_COLORS[2]} dp={2} height={220} />
          </Card>

          <Card title="Resting heart rate" note="Morning reading, last 90 days — lower is better">
            <MetricChart series={rhr} shape="line" color={SERIES_COLORS[1]} dp={1} invertY height={220} />
          </Card>

          <Card title="Readiness score" note="HRV4Training composite, last 90 days">
            <MetricChart series={readiness} shape="area" color={SERIES_COLORS[3]} dp={0} height={220} />
          </Card>
        </div>

        <RecoveryClient
          initialDay={day}
          initialSupplements={supplements}
          initialProtocols={protocols}
          protocolTotals={totals}
          adherence={adherence}
          efficiencyPoints={efficiency.points}
        />
      </div>
    </>
  );
}

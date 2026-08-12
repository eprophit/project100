'use client';

import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_SURFACE, MAX_SERIES, SERIES_COLORS, STATUS_COLORS } from '@/lib/palette';
import type { Series } from '@/lib/types';

/**
 * Chart primitives.
 *
 * Two rules from the design system are load-bearing here:
 *  1. Never two y-scales on one plot. Overlaying metrics with different units
 *     therefore z-scores them onto a shared axis, or falls back to small
 *     multiples — it does not grow a second axis.
 *  2. Series colours are assigned by slot order and never cycled. Past eight
 *     series the picker stops rather than inventing a ninth hue.
 */


const GRID = 'color-mix(in srgb, var(--border) 70%, transparent)';
const AXIS = 'var(--text-muted)';

export function formatDayShort(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmt(value: number | null | undefined, dp = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipPayloadItem {
  dataKey?: string | number;
  name?: string | number;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({
  active,
  payload,
  label,
  units,
  dpByKey,
  rawKeySuffix,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  units?: Record<string, string>;
  dpByKey?: Record<string, number>;
  /** When set, the tooltip prefers `${key}${suffix}` from the row (real values). */
  rawKeySuffix?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="tooltip">
      <div className="tooltip-day">{label ? formatDayShort(String(label)) : ''}</div>
      {payload.map((item) => {
        const key = String(item.dataKey ?? '');
        const raw =
          rawKeySuffix && item.payload
            ? (item.payload[`${key}${rawKeySuffix}`] as number | undefined)
            : undefined;
        const shown = raw ?? item.value;
        return (
          <div className="tooltip-row" key={key}>
            <span className="dot" style={{ background: item.color }} />
            <span>{item.name}</span>
            <span className="tooltip-val">
              {fmt(shown, dpByKey?.[key] ?? 1)}
              {units?.[key] ? ` ${units[key]}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend — always present for ≥2 series, and carries the latest value so
// identity never rests on colour alone.
// ---------------------------------------------------------------------------

export function ChartLegend({
  items,
}: {
  items: { label: string; color: string; value?: string }[];
}) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span className="legend-item" key={it.label}>
          <span className="dot" style={{ background: it.color }} />
          <span>{it.label}</span>
          {it.value ? <span className="mono muted">{it.value}</span> : null}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-metric chart
// ---------------------------------------------------------------------------

export function MetricChart({
  series,
  shape = 'line',
  color = SERIES_COLORS[0] as string,
  height = 220,
  dp = 1,
  invertY = false,
  referenceBand,
}: {
  series: Series;
  shape?: 'line' | 'bar' | 'area' | 'scatter';
  color?: string;
  height?: number;
  dp?: number;
  /** For pace-style metrics where lower is better. */
  invertY?: boolean;
  referenceBand?: { from: number; to: number; label?: string };
}) {
  const data = series.points;
  if (!data.length) return <div className="empty">No data in this range.</div>;

  const units = { value: series.unit };
  const dpByKey = { value: dp };
  const gradientId = `grad-${series.metric.replace(/[^a-z0-9]/gi, '-')}`;

  // One chart type with a swappable mark, rather than four branches each
  // repeating the axes. Recharts only inspects its *direct* children, so the
  // axes, grid and tooltip cannot be hoisted into a shared fragment — doing so
  // silently drops them and renders a bare plot area.
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={formatDayShort}
          stroke={AXIS}
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={40}
        />
        <YAxis
          stroke={AXIS}
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          width={46}
          reversed={invertY}
          domain={['auto', 'auto']}
        />
        <Tooltip
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          content={<ChartTooltip units={units} dpByKey={dpByKey} />}
        />
        {referenceBand ? (
          <ReferenceArea
            y1={referenceBand.from}
            y2={referenceBand.to}
            fill={STATUS_COLORS.good}
            fillOpacity={0.12}
            stroke="none"
          />
        ) : null}
        {shape === 'bar' ? (
          <Bar dataKey="value" name={series.label} fill={color} radius={[4, 4, 0, 0]} maxBarSize={14} />
        ) : null}
        {shape === 'area' ? (
          <Area
            type="monotone"
            dataKey="value"
            name={series.label}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_SURFACE }}
          />
        ) : null}
        {shape === 'scatter' ? (
          <Scatter dataKey="value" name={series.label} fill={color} shape="circle" />
        ) : null}
        {shape === 'line' ? (
          <Line
            type="monotone"
            dataKey="value"
            name={series.label}
            stroke={color}
            strokeWidth={2}
            dot={data.length <= 12 ? { r: 3, fill: color, strokeWidth: 0 } : false}
            connectNulls
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_SURFACE }}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Overlay: several metrics, one shared axis
// ---------------------------------------------------------------------------

export interface OverlaySeries {
  id: string;
  label: string;
  unit: string;
  dp: number;
  color: string;
  /** Plotted values — z-scores in normalized mode, real values otherwise. */
  points: { day: string; value: number }[];
  /** Real values, kept alongside so the tooltip can show units. */
  rawPoints?: { day: string; value: number }[];
}

/** Merges several series into the row shape Recharts wants. */
function toRows(series: OverlaySeries[]): Record<string, unknown>[] {
  const days = new Set<string>();
  for (const s of series) for (const p of s.points) days.add(p.day);

  const sorted = [...days].sort();
  const byId = new Map(
    series.map((s) => [
      s.id,
      { plotted: new Map(s.points.map((p) => [p.day, p.value])), raw: new Map((s.rawPoints ?? s.points).map((p) => [p.day, p.value])) },
    ]),
  );

  return sorted.map((day) => {
    const row: Record<string, unknown> = { day };
    for (const s of series) {
      const entry = byId.get(s.id)!;
      // `undefined` (not null) makes Recharts break the line across gaps
      // instead of drawing through them.
      row[s.id] = entry.plotted.get(day) ?? undefined;
      row[`${s.id}__raw`] = entry.raw.get(day) ?? undefined;
    }
    return row;
  });
}

export function OverlayChart({
  series,
  height = 320,
  normalized,
  connectGaps = false,
}: {
  series: OverlaySeries[];
  height?: number;
  normalized: boolean;
  /**
   * Bridge missing days. Needed for episodic series (a lift performed twice a
   * week, a lab panel every quarter): without it every point is isolated and a
   * dot-less line renders nothing at all.
   */
  connectGaps?: boolean;
}) {
  if (!series.length) return <div className="empty">Pick a metric to plot.</div>;
  const rows = toRows(series);
  if (!rows.length) return <div className="empty">No data in this range.</div>;

  const units = Object.fromEntries(series.map((s) => [s.id, s.unit]));
  const dpByKey = Object.fromEntries(series.map((s) => [s.id, s.dp]));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={formatDayShort}
          stroke={AXIS}
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={44}
        />
        <YAxis
          stroke={AXIS}
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          width={46}
          domain={['auto', 'auto']}
          label={
            normalized
              ? { value: 'z-score', angle: -90, position: 'insideLeft', fill: AXIS, fontSize: 11 }
              : undefined
          }
        />
        {normalized ? <ReferenceLine y={0} stroke={GRID} strokeDasharray="3 3" /> : null}
        <Tooltip
          cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          content={<ChartTooltip units={units} dpByKey={dpByKey} rawKeySuffix="__raw" />}
        />
        {series.map((s) => (
          <Line
            key={s.id}
            type="monotone"
            dataKey={s.id}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            connectNulls={connectGaps}
            dot={connectGaps ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_SURFACE }}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Small multiples — the honest alternative to a second y-axis
// ---------------------------------------------------------------------------

export function SmallMultiples({ series }: { series: OverlaySeries[] }) {
  if (!series.length) return <div className="empty">Pick a metric to plot.</div>;

  return (
    <div className="stack">
      {series.map((s) => (
        <div key={s.id}>
          <div className="row" style={{ marginBottom: 2 }}>
            <span className="dot" style={{ background: s.color }} />
            <h3>{s.label}</h3>
            <span className="small muted">{s.unit}</span>
          </div>
          <MetricChart
            series={{ metric: s.id, label: s.label, unit: s.unit, points: s.rawPoints ?? s.points }}
            color={s.color}
            height={128}
            dp={s.dp}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline for stat tiles
// ---------------------------------------------------------------------------

export function Sparkline({
  points,
  color = SERIES_COLORS[0] as string,
  height = 36,
}: {
  points: { day: string; value: number }[];
  color?: string;
  height?: number;
}) {
  if (points.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, '')})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

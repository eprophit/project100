import type { ReactNode } from 'react';

export function Card({
  title,
  note,
  action,
  children,
  className,
}: {
  title?: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || action) && (
        <header className="card-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {note ? <div className="card-note">{note}</div> : null}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  unit,
  meta,
  tone,
  children,
}: {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  meta?: ReactNode;
  tone?: 'good' | 'warning' | 'serious' | 'critical';
  children?: ReactNode;
}) {
  const shown = value == null || value === '' ? '—' : value;
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {shown}
        {unit && shown !== '—' ? <span className="stat-unit">{unit}</span> : null}
      </div>
      {meta ? <div className="stat-meta">{meta}</div> : null}
      {children}
    </div>
  );
}

/** Status badges always pair the colour with a glyph and a word. */
export function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    optimal: { cls: 'badge-good', icon: '●', label: 'Optimal' },
    in_range: { cls: '', icon: '○', label: 'In range' },
    out_of_range: { cls: 'badge-critical', icon: '▲', label: 'Out of range' },
    ok: { cls: 'badge-good', icon: '●', label: 'OK' },
    partial: { cls: 'badge-warning', icon: '◐', label: 'Partial' },
    error: { cls: 'badge-critical', icon: '▲', label: 'Error' },
    running: { cls: '', icon: '◌', label: 'Running' },
  };
  const s = map[status ?? ''] ?? { cls: '', icon: '·', label: status ?? 'Unknown' };
  return (
    <span className={`badge ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

export function Meter({
  value,
  target,
  color = 'var(--series-1)',
}: {
  value: number;
  target: number;
  color?: string;
}) {
  const pct = target > 0 ? Math.min(140, (value / target) * 100) : 0;
  return (
    <div className="meter" role="img" aria-label={`${Math.round(pct)}% of target`}>
      <div className="meter-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

/**
 * A biomarker value against its reference and optimal bands.
 * The marker carries a 2px surface ring so it stays legible over either band.
 */
export function RangeBar({
  value,
  refLow,
  refHigh,
  optLow,
  optHigh,
  status,
}: {
  value: number;
  refLow: number | null;
  refHigh: number | null;
  optLow: number | null;
  optHigh: number | null;
  status: string | null;
}) {
  const lo = Math.min(refLow ?? value * 0.5, optLow ?? value * 0.5, value) * 0.85;
  const hi = Math.max(refHigh ?? value * 1.5, optHigh ?? value * 1.5, value) * 1.15;
  const span = hi - lo || 1;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0, Math.min(100, ((b - a) / span) * 100))}%`;

  const rl = refLow ?? lo;
  const rh = refHigh ?? hi;
  const ol = optLow ?? rl;
  const oh = optHigh ?? rh;

  const color =
    status === 'out_of_range' ? 'var(--critical)' : status === 'optimal' ? 'var(--good)' : 'var(--text-secondary)';

  return (
    <div className="range-track">
      <div className="range-ref" style={{ left: pos(rl), width: width(rl, rh) }} />
      {optLow != null || optHigh != null ? (
        <div className="range-opt" style={{ left: pos(ol), width: width(ol, oh) }} />
      ) : null}
      <div className="range-marker" style={{ left: pos(value), background: color }} />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

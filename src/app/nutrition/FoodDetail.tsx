'use client';

import { NUTRIENT_META, formatAmount, round, type Nutrients, type Unit } from '@/lib/nutrition';

/**
 * The full nutrient panel for one logged item.
 *
 * Two columns of numbers, deliberately: `amount` is what this entry actually
 * contributes, and `per100g` is the food's composition. A user comparing two
 * foods wants the second; a user checking whether they hit their iron target
 * wants the first. Showing only one of them makes half the questions
 * unanswerable.
 */

const GROUP_LABEL: Record<string, string> = {
  macro: 'Macronutrients',
  carb: 'Carbohydrate detail',
  fat: 'Fat detail',
  mineral: 'Minerals',
  vitamin: 'Vitamins',
  other: 'Other',
};

const GROUP_ORDER = ['macro', 'carb', 'fat', 'mineral', 'vitamin', 'other'];

export function FoodDetail({
  name,
  brand,
  quantity,
  unit,
  servingG,
  servingLabel,
  basis,
  nutrients,
  base,
  onClose,
}: {
  name: string;
  brand: string | null;
  quantity: number;
  unit: Unit;
  servingG: number | null;
  servingLabel?: string | null;
  basis: string;
  /** Nutrients for the amount as logged. */
  nutrients: Nutrients;
  /** Per 100 g, or per serving for entries with no known weight. */
  base: Nutrients;
  onClose?: () => void;
}) {
  const perLabel = basis === 'per_100g' ? 'per 100 g' : 'per serving';

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div className="strong">{name}</div>
          <div className="small muted">
            {brand ? `${brand} · ` : ''}
            {formatAmount(quantity, unit, servingG)}
            {servingLabel ? ` · 1 serving = ${servingLabel}` : ''}
          </div>
        </div>
        {onClose ? (
          <button className="btn btn-sm" type="button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Nutrient</th>
              <th className="num">This amount</th>
              <th className="num">{perLabel}</th>
              <th className="num">% RDI</th>
            </tr>
          </thead>
          <tbody>
            {GROUP_ORDER.map((group) => {
              const rows = NUTRIENT_META.filter((m) => m.group === group);
              if (!rows.length) return null;
              return (
                <NutrientGroup key={group} label={GROUP_LABEL[group]} rows={rows} nutrients={nutrients} base={base} />
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="small muted" style={{ marginBottom: 0, marginTop: 10 }}>
        % RDI is against a general adult reference intake, not a target tuned to
        this training load. Values are catalog reference figures captured when
        the item was added.
      </p>
    </div>
  );
}

function NutrientGroup({
  label,
  rows,
  nutrients,
  base,
}: {
  label: string;
  rows: typeof NUTRIENT_META;
  nutrients: Nutrients;
  base: Nutrients;
}) {
  return (
    <>
      <tr>
        <td colSpan={4} className="nutrient-group">
          {label}
        </td>
      </tr>
      {rows.map((m) => {
        const value = nutrients[m.key] ?? 0;
        const pct = m.rdi ? Math.round((value / m.rdi) * 100) : null;
        return (
          <tr key={m.key}>
            <td>{m.label}</td>
            <td className="num strong">
              {round(value, m.dp).toLocaleString()} {m.unit}
            </td>
            <td className="num muted">{round(base[m.key] ?? 0, m.dp).toLocaleString()}</td>
            <td className="num muted">{pct == null ? '—' : `${pct}%`}</td>
          </tr>
        );
      })}
    </>
  );
}

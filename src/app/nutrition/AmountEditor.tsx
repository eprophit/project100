'use client';

import { useEffect, useState } from 'react';
import { convertQuantity, round, type Unit } from '@/lib/nutrition';

/**
 * Quantity + unit, edited in place.
 *
 * Changing the unit converts rather than reinterprets: 150 g becomes 5.29 oz,
 * not 150 oz. That is the whole reason nutrients are stored per 100 g — the
 * switch is arithmetic, so it can happen without asking the user to re-enter
 * anything.
 *
 * Typing commits on blur or Enter; the unit select commits immediately, since
 * there is nothing half-finished about picking one.
 */
export function AmountEditor({
  quantity,
  unit,
  servingG,
  units,
  disabled,
  onCommit,
}: {
  quantity: number;
  unit: Unit;
  servingG: number | null;
  units: Unit[];
  disabled?: boolean;
  onCommit: (quantity: number, unit: Unit) => void;
}) {
  const [draft, setDraft] = useState(String(round(quantity, 2)));

  // A template application or a copy can change the amount underneath us.
  useEffect(() => {
    setDraft(String(round(quantity, 2)));
  }, [quantity]);

  function commit() {
    const next = Number(draft);
    if (!Number.isFinite(next) || next < 0) {
      setDraft(String(round(quantity, 2)));
      return;
    }
    if (round(next, 2) === round(quantity, 2)) return;
    onCommit(next, unit);
  }

  function changeUnit(next: Unit) {
    if (next === unit) return;
    const converted = convertQuantity(quantity, unit, next, servingG);
    onCommit(converted ?? quantity, next);
  }

  const step = unit === 'g' ? 5 : unit === 'oz' ? 0.5 : 0.25;

  return (
    <span className="amount-editor">
      <input
        type="number"
        min={0}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label="Amount"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <select
        value={unit}
        disabled={disabled || units.length < 2}
        aria-label="Unit"
        onChange={(e) => changeUnit(e.target.value as Unit)}
      >
        {units.map((u) => (
          <option key={u} value={u}>
            {u === 'serving' ? 'serving' : u}
          </option>
        ))}
      </select>
    </span>
  );
}

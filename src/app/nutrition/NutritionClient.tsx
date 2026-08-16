'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AmountEditor } from './AmountEditor';
import { FoodDetail } from './FoodDetail';
import { TemplateLibrary } from './TemplateLibrary';
import type { NutritionPayload } from './payload';
import { MetricChart } from '@/components/charts';
import { Card, Meter } from '@/components/ui';
import { DOW_NAMES, addDays, formatDay, today } from '@/lib/dates';
import type { FoodRow, ResolvedEntry } from '@/lib/mealPlans';
import { MEAL_LABEL, MEAL_SLOTS, formatAmount, round, type Unit } from '@/lib/nutrition';
import { SERIES_COLORS } from '@/lib/palette';

/**
 * The nutrition tab.
 *
 * Built around the observation that this user eats roughly the same things most
 * days: the fastest paths — copy yesterday, apply a saved day, roll out a saved
 * week — are top-level buttons, and searching for a food one at a time is the
 * slow path you fall back to when something changes.
 */

export function NutritionClient({
  initial,
  kcalSeries,
}: {
  initial: NutritionPayload;
  kcalSeries: { day: string; value: number }[];
}) {
  const [data, setData] = useState<NutritionPayload>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Add-food controls.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodRow[]>([]);
  const [slot, setSlot] = useState<string>('breakfast');
  const [quantity, setQuantity] = useState(100);
  const [unit, setUnit] = useState<Unit>('g');

  const { day, planned } = data;

  const post = useCallback(
    async (body: Record<string, unknown>, message?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch('/api/nutrition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day, planned, ...body }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Something went wrong.');
          return;
        }
        setData(json as NutritionPayload);
        if (json.sync) {
          const s = json.sync;
          setNotice(`MyFitnessPal: ${s.inserted} new, ${s.updated} updated, ${s.skipped} unchanged.`);
        } else if (message) {
          setNotice(message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [day, planned],
  );

  const load = useCallback(async (nextDay: string, nextPlanned: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/nutrition?day=${nextDay}&planned=${nextPlanned ? 1 : 0}`);
      setData((await res.json()) as NutritionPayload);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Food search, debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch(`/api/nutrition?foods=${encodeURIComponent(query)}`);
      const json = (await res.json()) as { foods: FoodRow[] };
      setResults(json.foods.slice(0, 14));
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const selectedEntry = useMemo(
    () => data.entries.find((e) => e.id === selected) ?? null,
    [data.entries, selected],
  );

  const emptySlots = MEAL_SLOTS.filter((s) => !data.meals.some((m) => m.slot === s));

  return (
    <>
      <Card
        title={planned ? 'Meal plan' : 'Food log'}
        note={
          planned
            ? 'What you intend to eat. Save it as a day or a week once it looks right.'
            : 'What was actually eaten — MyFitnessPal imports plus anything added here.'
        }
        action={
          <div className="row-tight">
            <button className="btn btn-sm" type="button" onClick={() => load(addDays(day, -1), planned)} disabled={busy}>
              ‹
            </button>
            <input type="date" value={day} onChange={(e) => load(e.target.value, planned)} />
            <button className="btn btn-sm" type="button" onClick={() => load(addDays(day, 1), planned)} disabled={busy}>
              ›
            </button>
            <button className="btn btn-sm" type="button" onClick={() => load(today(), planned)} disabled={busy}>
              Today
            </button>
            <div className="segmented">
              <button type="button" onClick={() => load(day, false)} aria-pressed={!planned}>
                Log
              </button>
              <button type="button" onClick={() => load(day, true)} aria-pressed={planned}>
                Plan
              </button>
            </div>
          </div>
        }
      >
        <div className="control-bar">
          <button
            className="btn btn-sm"
            type="button"
            disabled={busy}
            onClick={() => post({ action: 'copyDay', from: addDays(day, -1), replace: false }, 'Copied yesterday.')}
          >
            Copy yesterday
          </button>
          <button
            className="btn btn-sm"
            type="button"
            disabled={busy}
            onClick={() => post({ action: 'syncMyFitnessPal' })}
          >
            Pull from MyFitnessPal
          </button>
          <span className="spacer" />
          <button
            className="btn btn-sm"
            type="button"
            disabled={busy || !data.entries.length}
            onClick={() => {
              const name = window.prompt('Name this day', `${formatDay(day)} — ${planned ? 'plan' : 'log'}`);
              if (name) void post({ action: 'saveDay', name }, `Saved “${name}”.`);
            }}
          >
            Save day as template
          </button>
          <button
            className="btn btn-sm"
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Remove everything added in this app for this day? Imported entries stay.')) {
                void post({ action: 'clear' }, 'Cleared.');
              }
            }}
          >
            Clear
          </button>
        </div>

        {error ? <div className="banner banner-error">{error}</div> : null}
        {notice ? <div className="banner">{notice}</div> : null}

        <div className="week-strip">
          {data.week.map((w, i) => (
            <button
              key={w.day}
              type="button"
              className="week-strip-cell"
              aria-pressed={w.day === day}
              onClick={() => load(w.day, planned)}
              disabled={busy}
            >
              <span className="week-strip-dow">
                {DOW_NAMES[i]} <span className="muted">{formatDay(w.day)}</span>
              </span>
              <span className="week-strip-kcal mono">{w.count ? round(w.totals.kcal, 0).toLocaleString() : '—'}</span>
              <span className="week-strip-bar">
                <span
                  style={{
                    width: `${Math.min(100, (w.totals.kcal / Math.max(1, data.targets.kcal)) * 100)}%`,
                    background: SERIES_COLORS[3],
                  }}
                />
              </span>
            </button>
          ))}
        </div>

        {data.meals.map((m) => (
          <div key={m.slot} className="meal-block">
            <div className="meal-head">
              <div className="strong">{MEAL_LABEL[m.slot] ?? m.slot}</div>
              <div className="meal-macros mono">
                {round(m.totals.kcal, 0).toLocaleString()} kcal
                <span className="muted">
                  {' '}
                  · {round(m.totals.protein_g, 0)}p · {round(m.totals.carbs_g, 0)}c · {round(m.totals.fat_g, 0)}f ·{' '}
                  {round(m.totals.fiber_g, 0)} fib
                </span>
              </div>
              <button
                className="btn btn-sm"
                type="button"
                disabled={busy}
                onClick={() => {
                  const name = window.prompt('Name this meal', `${MEAL_LABEL[m.slot] ?? m.slot} — ${formatDay(day)}`);
                  if (name) void post({ action: 'saveMeal', slot: m.slot, name }, `Saved “${name}”.`);
                }}
              >
                Save meal
              </button>
            </div>

            <div className="scroll-x">
              <table>
                <tbody>
                  {m.entries.map((e) => (
                    <EntryRowView
                      key={e.id}
                      entry={e}
                      busy={busy}
                      selected={selected === e.id}
                      onSelect={() => setSelected(selected === e.id ? null : e.id)}
                      onAmount={(q, u) => post({ action: 'amount', id: e.id, quantity: q, unit: u })}
                      onDelete={() => post({ action: 'delete', id: e.id })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {!data.meals.length ? (
          <div className="empty">
            Nothing {planned ? 'planned' : 'logged'} for {formatDay(day)}. Copy yesterday, apply a saved day, or add a
            food below.
          </div>
        ) : null}

        {emptySlots.length ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            No {emptySlots.map((s) => (MEAL_LABEL[s] ?? s).toLowerCase()).join(', ')} recorded.
          </p>
        ) : null}
      </Card>

      <div className="grid grid-2">
        <Card title={planned ? 'Plan vs target' : 'Totals vs target'}>
          <div className="stack" style={{ gap: 12 }}>
            <TargetRow label="Energy" value={data.totals.kcal} target={data.targets.kcal} unit="kcal" color={SERIES_COLORS[3]} />
            <TargetRow label="Protein" value={data.totals.protein_g} target={data.targets.protein_g} unit="g" color={SERIES_COLORS[0]} />
            <TargetRow label="Carbohydrate" value={data.totals.carbs_g} target={data.targets.carbs_g} unit="g" color={SERIES_COLORS[2]} />
            <TargetRow label="Fat" value={data.totals.fat_g} target={data.targets.fat_g} unit="g" color={SERIES_COLORS[1]} />
            <TargetRow label="Fibre" value={data.totals.fiber_g} target={data.targets.fiber_g} unit="g" color={SERIES_COLORS[5]} />
            <TargetRow label="Sodium" value={data.totals.sodium_mg} target={data.targets.sodium_mg} unit="mg" color={SERIES_COLORS[4]} />
          </div>
        </Card>

        <Card
          title={selectedEntry ? 'Nutrients' : 'Add food'}
          note={
            selectedEntry
              ? undefined
              : `Adds to the ${planned ? 'plan' : 'log'} for ${formatDay(day)}. Amounts are grams by default; switch the unit on any row afterwards.`
          }
        >
          {selectedEntry ? (
            <FoodDetail
              name={selectedEntry.food}
              brand={selectedEntry.brand}
              quantity={selectedEntry.quantity}
              unit={selectedEntry.unit}
              servingG={selectedEntry.serving_g}
              basis={selectedEntry.basis}
              nutrients={selectedEntry.nutrients}
              base={selectedEntry.base}
              onClose={() => setSelected(null)}
            />
          ) : (
            <>
              <div className="control-bar">
                <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Meal">
                  {MEAL_SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {MEAL_LABEL[s] ?? s}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  step={unit === 'g' ? 5 : 0.25}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                  style={{ width: 82 }}
                  aria-label="Amount"
                />
                <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unit">
                  <option value="g">g</option>
                  <option value="oz">oz</option>
                  <option value="serving">servings</option>
                </select>
                <input
                  type="search"
                  placeholder="Search foods…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ flex: 1, minWidth: 140 }}
                />
              </div>

              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Food</th>
                      <th className="num">Serving</th>
                      <th className="num">kcal/100 g</th>
                      <th className="num">P / C / F</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((f) => (
                      <tr key={f.id}>
                        <td className="strong">
                          {f.name}
                          {f.brand ? <div className="small muted">{f.brand}</div> : null}
                        </td>
                        <td className="num muted">
                          {f.serving_label}
                          {f.serving_g ? ` · ${round(f.serving_g, 0)} g` : ''}
                        </td>
                        <td className="num">{round(f.kcal, 0)}</td>
                        <td className="num muted">
                          {round(f.protein_g)} / {round(f.carbs_g)} / {round(f.fat_g)}
                        </td>
                        <td style={{ width: 56 }}>
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={busy || quantity <= 0}
                            onClick={() => post({ action: 'add', slot, foodId: f.id, quantity, unit })}
                          >
                            Add
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>

      <TemplateLibrary
        data={data}
        busy={busy}
        onApplyMeal={(id, s) => post({ action: 'applyMeal', templateId: id, slot: s }, 'Meal added.')}
        onApplyDay={(id, replace) => post({ action: 'applyDay', templateId: id, replace }, 'Day applied.')}
        onApplyWeek={(id, replace) =>
          post(
            { action: 'applyWeek', templateId: id, startDay: data.weekStart, replace },
            `Week of ${formatDay(data.weekStart)} filled in.`,
          )
        }
        onDelete={(kind, id) => {
          const action =
            kind === 'meals' ? 'deleteMealTemplate' : kind === 'days' ? 'deleteDayTemplate' : 'deleteWeekTemplate';
          if (window.confirm('Delete this saved plan?')) void post({ action, id }, 'Deleted.');
        }}
        onSaveDay={() => {
          const name = window.prompt('Name this day', `${formatDay(day)} — ${planned ? 'plan' : 'log'}`);
          if (name) void post({ action: 'saveDay', name }, `Saved “${name}”.`);
        }}
        onSaveWeek={() => {
          const name = window.prompt('Name this week', `Week of ${formatDay(data.weekStart)}`);
          if (name) void post({ action: 'saveWeek', startDay: data.weekStart, name }, `Saved “${name}”.`);
        }}
      />

      <Card title="Energy intake" note="Last 30 days of logged intake against the daily target">
        <MetricChart
          series={{ metric: 'nutrition.kcal', label: 'Energy', unit: 'kcal', points: kcalSeries }}
          shape="bar"
          color={SERIES_COLORS[3]}
          dp={0}
          height={240}
          referenceBand={{
            from: data.targets.kcal * 0.9,
            to: data.targets.kcal * 1.1,
            label: 'Target ±10%',
          }}
        />
      </Card>
    </>
  );
}

function EntryRowView({
  entry,
  busy,
  selected,
  onSelect,
  onAmount,
  onDelete,
}: {
  entry: ResolvedEntry;
  busy: boolean;
  selected: boolean;
  onSelect: () => void;
  onAmount: (quantity: number, unit: Unit) => void;
  onDelete: () => void;
}) {
  return (
    <tr aria-selected={selected}>
      <td>
        <button type="button" className="link-btn" onClick={onSelect}>
          {entry.food}
        </button>
        <div className="small muted">
          {entry.brand ? `${entry.brand} · ` : ''}
          {formatAmount(entry.quantity, entry.unit, entry.serving_g)}
          {entry.source_id !== 'local' ? ` · ${entry.source_id}` : ''}
        </div>
      </td>
      <td style={{ width: 150 }}>
        <AmountEditor
          quantity={entry.quantity}
          unit={entry.unit}
          servingG={entry.serving_g}
          units={entry.editableUnits}
          disabled={busy}
          onCommit={onAmount}
        />
      </td>
      <td className="num strong" style={{ width: 68 }}>
        {round(entry.nutrients.kcal, 0)}
      </td>
      <td className="num muted" style={{ width: 150 }}>
        {round(entry.nutrients.protein_g, 0)}p · {round(entry.nutrients.carbs_g, 0)}c ·{' '}
        {round(entry.nutrients.fat_g, 0)}f
      </td>
      <td style={{ width: 30 }}>
        <button
          className="btn btn-sm"
          type="button"
          onClick={onDelete}
          aria-label={`Remove ${entry.food}`}
          disabled={busy}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

function TargetRow({
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
  const pct = target ? Math.round((value / target) * 100) : 0;
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="small">{label}</span>
        <span className="small mono">
          {Math.round(value).toLocaleString()} / {Math.round(target).toLocaleString()} {unit}
          <span className="muted"> · {pct}%</span>
        </span>
      </div>
      <Meter value={value} target={target} color={color} />
    </div>
  );
}

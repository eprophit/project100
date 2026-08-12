'use client';

import { useMemo, useState, useTransition } from 'react';
import { MetricChart } from '@/components/charts';
import { SERIES_COLORS } from '@/lib/palette';
import { Card, Meter } from '@/components/ui';
import type { Food, MacroTargets, NutritionEntry } from '@/lib/types';

interface DayPayload {
  day: string;
  logged: NutritionEntry[];
  planned: NutritionEntry[];
  totals: Totals;
  plannedTotals: Totals;
  targets: MacroTargets;
}

interface Totals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
}

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'intra'] as const;

export function NutritionClient({
  initial,
  foods,
  kcalSeries,
}: {
  initial: DayPayload;
  foods: Food[];
  kcalSeries: { day: string; value: number }[];
}) {
  const [data, setData] = useState<DayPayload>(initial);
  const [day, setDay] = useState(initial.day);
  const [tab, setTab] = useState<'log' | 'plan'>('log');
  const [query, setQuery] = useState('');
  const [meal, setMeal] = useState<(typeof MEALS)[number]>('breakfast');
  const [servings, setServings] = useState(1);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? foods.filter((f) => f.name.toLowerCase().includes(q) || (f.tags ?? '').includes(q))
      : foods;
    return list.slice(0, 12);
  }, [foods, query]);

  const entries = tab === 'log' ? data.logged : data.planned;
  const totals = tab === 'log' ? data.totals : data.plannedTotals;

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setData(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/nutrition?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setData(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function changeDay(next: string) {
    setDay(next);
    startTransition(async () => {
      const res = await fetch(`/api/nutrition?day=${next}`);
      setData(await res.json());
    });
  }

  /**
   * Fills the plan from the remaining macro gap: picks the food that best closes
   * the largest deficit, greedily, so the suggestion is reproducible rather than
   * a random shuffle.
   */
  function suggestPlan() {
    const remaining = {
      kcal: data.targets.kcal - data.plannedTotals.kcal,
      protein: data.targets.protein_g - data.plannedTotals.protein_g,
      carbs: data.targets.carbs_g - data.plannedTotals.carbs_g,
      fat: data.targets.fat_g - data.plannedTotals.fat_g,
    };
    if (remaining.kcal <= 80) return;

    const scored = foods
      .filter((f) => f.kcal > 40)
      .map((f) => {
        const proteinFit = remaining.protein > 0 ? (f.protein_g / f.kcal) * 400 : 0;
        const carbFit = remaining.carbs > 0 ? (f.carbs_g / f.kcal) * 60 : 0;
        const fatFit = remaining.fat > 0 ? (f.fat_g / f.kcal) * 60 : 0;
        return { food: f, score: proteinFit * 2 + carbFit + fatFit };
      })
      .sort((a, b) => b.score - a.score);

    const pick = scored[0];
    if (!pick) return;
    const needed = Math.max(0.5, Math.min(3, Math.round((remaining.kcal / pick.food.kcal) * 2) / 2));
    void post({ day, meal, foodId: pick.food.id, servings: needed, planned: true });
  }

  return (
    <>
      <div className="grid grid-2">
        <Card
          title={tab === 'log' ? 'Food log' : 'Meal plan'}
          note={tab === 'log' ? 'What was actually eaten' : 'What you intend to eat — compared against the log below'}
          action={
            <div className="row-tight">
              <input type="date" value={day} onChange={(e) => changeDay(e.target.value)} />
              <div className="segmented">
                <button type="button" onClick={() => setTab('log')} aria-pressed={tab === 'log'}>
                  Log
                </button>
                <button type="button" onClick={() => setTab('plan')} aria-pressed={tab === 'plan'}>
                  Plan
                </button>
              </div>
            </div>
          }
        >
          {pending ? <div className="empty">Loading…</div> : null}

          {MEALS.map((m) => {
            const rows = entries.filter((e) => e.meal === m);
            if (!rows.length) return null;
            return (
              <div key={m} style={{ marginBottom: 14 }}>
                <div className="nav-group-label" style={{ padding: '2px 0 4px' }}>
                  {m}
                </div>
                <div className="scroll-x">
                  <table>
                    <tbody>
                      {rows.map((e) => (
                        <tr key={e.id}>
                          <td className="strong">
                            {e.food}
                            {e.servings !== 1 ? <span className="muted"> × {e.servings}</span> : null}
                            {e.brand ? <div className="small muted">{e.brand}</div> : null}
                          </td>
                          <td className="num">{Math.round(e.kcal)} kcal</td>
                          <td className="num muted">
                            {Math.round(e.protein_g)}p · {Math.round(e.carbs_g)}c · {Math.round(e.fat_g)}f
                          </td>
                          <td style={{ width: 30 }}>
                            <button
                              className="btn btn-sm"
                              type="button"
                              onClick={() => remove(e.id)}
                              aria-label={`Remove ${e.food}`}
                              disabled={busy}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {!entries.length && !pending ? (
            <div className="empty">
              Nothing {tab === 'log' ? 'logged' : 'planned'} for this day yet.
            </div>
          ) : null}
        </Card>

        <Card
          title={tab === 'log' ? 'Totals vs target' : 'Plan vs target'}
          action={
            tab === 'plan' ? (
              <button className="btn btn-sm" type="button" onClick={suggestPlan} disabled={busy}>
                Fill the gap
              </button>
            ) : undefined
          }
        >
          <div className="stack" style={{ gap: 12 }}>
            <Row label="Energy" value={totals.kcal} target={data.targets.kcal} unit="kcal" color={SERIES_COLORS[3]} />
            <Row label="Protein" value={totals.protein_g} target={data.targets.protein_g} unit="g" color={SERIES_COLORS[0]} />
            <Row label="Carbohydrate" value={totals.carbs_g} target={data.targets.carbs_g} unit="g" color={SERIES_COLORS[2]} />
            <Row label="Fat" value={totals.fat_g} target={data.targets.fat_g} unit="g" color={SERIES_COLORS[1]} />
            <Row label="Fibre" value={totals.fiber_g} target={data.targets.fiber_g} unit="g" color={SERIES_COLORS[5]} />
            <Row label="Sodium" value={totals.sodium_mg} target={data.targets.sodium_mg} unit="mg" color={SERIES_COLORS[4]} />
          </div>

          {tab === 'plan' && data.logged.length ? (
            <p className="small muted" style={{ marginTop: 14, marginBottom: 0 }}>
              Logged so far today: {Math.round(data.totals.kcal).toLocaleString()} kcal ·{' '}
              {Math.round(data.totals.protein_g)} g protein. Plan minus log ={' '}
              {Math.round(data.plannedTotals.kcal - data.totals.kcal).toLocaleString()} kcal.
            </p>
          ) : null}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Add food" note={`Adds to the ${tab === 'log' ? 'log' : 'plan'} for ${day}`}>
          <div className="control-bar">
            <select value={meal} onChange={(e) => setMeal(e.target.value as (typeof MEALS)[number])}>
              {MEALS.map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0.25}
              step={0.25}
              value={servings}
              onChange={(e) => setServings(Number(e.target.value) || 1)}
              style={{ width: 84 }}
              aria-label="Servings"
            />
            <input
              type="search"
              placeholder="Search foods…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, minWidth: 160 }}
            />
          </div>

          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Food</th>
                  <th className="num">Serving</th>
                  <th className="num">kcal</th>
                  <th className="num">P / C / F</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {matches.map((f) => (
                  <tr key={f.id}>
                    <td className="strong">{f.name}</td>
                    <td className="num muted">{f.serving}</td>
                    <td className="num">{f.kcal}</td>
                    <td className="num muted">
                      {f.protein_g} / {f.carbs_g} / {f.fat_g}
                    </td>
                    <td style={{ width: 60 }}>
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          post({ day, meal, foodId: f.id, servings, planned: tab === 'plan' })
                        }
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Energy intake" note="Last 30 days against target">
          <MetricChart
            series={{ metric: 'nutrition.kcal', label: 'Energy', unit: 'kcal', points: kcalSeries }}
            shape="bar"
            color={SERIES_COLORS[3]}
            dp={0}
            height={240}
          />
        </Card>
      </div>
    </>
  );
}

function Row({
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

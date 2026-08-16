'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import { DOW_NAMES } from '@/lib/dates';
import { MEAL_LABEL, formatAmount, round } from '@/lib/nutrition';
import type { NutritionPayload } from './payload';

/**
 * The saved-plan library: meals, days and weeks.
 *
 * A day template lists the *meal templates* it is built from rather than a flat
 * food list, because that is the actual relationship — editing "Chicken & rice
 * bowl" changes every day that includes it. Applying one to a date is where the
 * copy happens.
 */

type Tab = 'meals' | 'days' | 'weeks';

export function TemplateLibrary({
  data,
  busy,
  onApplyMeal,
  onApplyDay,
  onApplyWeek,
  onDelete,
  onSaveDay,
  onSaveWeek,
}: {
  data: NutritionPayload;
  busy: boolean;
  onApplyMeal: (id: string, slot?: string) => void;
  onApplyDay: (id: string, replace: boolean) => void;
  onApplyWeek: (id: string, replace: boolean) => void;
  onDelete: (kind: Tab, id: string) => void;
  onSaveDay: () => void;
  onSaveWeek: () => void;
}) {
  const [tab, setTab] = useState<Tab>('meals');
  const [open, setOpen] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);

  const target = data.planned ? 'plan' : 'log';

  return (
    <Card
      title="Saved plans"
      note={`Applying copies the items into the ${target} for ${data.day} — the copy is then yours to edit without touching the template.`}
      action={
        <div className="row-tight">
          <div className="segmented">
            <button type="button" onClick={() => setTab('meals')} aria-pressed={tab === 'meals'}>
              Meals ({data.library.meals.length})
            </button>
            <button type="button" onClick={() => setTab('days')} aria-pressed={tab === 'days'}>
              Days ({data.library.days.length})
            </button>
            <button type="button" onClick={() => setTab('weeks')} aria-pressed={tab === 'weeks'}>
              Weeks ({data.library.weeks.length})
            </button>
          </div>
        </div>
      }
    >
      <div className="control-bar">
        <label className="row-tight small">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace what&apos;s already there
        </label>
        <span className="spacer" />
        {tab === 'days' ? (
          <button className="btn btn-sm" type="button" onClick={onSaveDay} disabled={busy}>
            Save {data.day} as a day
          </button>
        ) : null}
        {tab === 'weeks' ? (
          <button className="btn btn-sm" type="button" onClick={onSaveWeek} disabled={busy}>
            Save this week
          </button>
        ) : null}
      </div>

      {tab === 'meals' ? (
        <div className="template-list">
          {data.library.meals.map((m) => (
            <div key={m.id} className="template-row">
              <div className="template-main">
                <button type="button" className="link-btn" onClick={() => setOpen(open === m.id ? null : m.id)}>
                  {m.name}
                </button>
                <div className="small muted">
                  {MEAL_LABEL[m.slot] ?? m.slot} · {m.items.length} item{m.items.length === 1 ? '' : 's'}
                  {m.used_count ? ` · used ${m.used_count}×` : ''}
                </div>
                {open === m.id ? (
                  <table className="template-items">
                    <tbody>
                      {m.items.map((i) => (
                        <tr key={i.template_item_id}>
                          <td>{i.food}</td>
                          <td className="num muted">{formatAmount(i.quantity, i.unit, i.serving_g)}</td>
                          <td className="num muted">{round(i.nutrients.kcal, 0)} kcal</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
              <div className="template-macros num">
                {round(m.totals.kcal, 0).toLocaleString()} kcal
                <div className="small muted">
                  {round(m.totals.protein_g, 0)}p · {round(m.totals.carbs_g, 0)}c · {round(m.totals.fat_g, 0)}f
                </div>
              </div>
              <div className="row-tight">
                <button className="btn btn-sm" type="button" disabled={busy} onClick={() => onApplyMeal(m.id)}>
                  Add
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={busy}
                  aria-label={`Delete ${m.name}`}
                  onClick={() => onDelete('meals', m.id)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          {!data.library.meals.length ? <div className="empty">No saved meals yet.</div> : null}
        </div>
      ) : null}

      {tab === 'days' ? (
        <div className="template-list">
          {data.library.days.map((d) => (
            <div key={d.id} className="template-row">
              <div className="template-main">
                <button type="button" className="link-btn" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  {d.name}
                </button>
                <div className="small muted">
                  {d.meals.length} meal{d.meals.length === 1 ? '' : 's'}
                  {d.notes ? ` · ${d.notes}` : ''}
                </div>
                {open === d.id ? (
                  <table className="template-items">
                    <tbody>
                      {d.meals.map((m) => (
                        <tr key={`${d.id}-${m.slot}-${m.template.id}`}>
                          <td className="muted">{MEAL_LABEL[m.slot] ?? m.slot}</td>
                          <td>{m.template.name}</td>
                          <td className="num muted">{round(m.template.totals.kcal, 0)} kcal</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
              <div className="template-macros num">
                {round(d.totals.kcal, 0).toLocaleString()} kcal
                <div className="small muted">
                  {round(d.totals.protein_g, 0)}p · {round(d.totals.carbs_g, 0)}c · {round(d.totals.fat_g, 0)}f
                </div>
              </div>
              <div className="row-tight">
                <button className="btn btn-sm" type="button" disabled={busy} onClick={() => onApplyDay(d.id, replace)}>
                  Apply
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={busy}
                  aria-label={`Delete ${d.name}`}
                  onClick={() => onDelete('days', d.id)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          {!data.library.days.length ? <div className="empty">No saved days yet.</div> : null}
        </div>
      ) : null}

      {tab === 'weeks' ? (
        <div className="template-list">
          {data.library.weeks.map((w) => (
            <div key={w.id} className="template-row">
              <div className="template-main">
                <div className="strong">{w.name}</div>
                {w.notes ? <div className="small muted">{w.notes}</div> : null}
                <div className="week-grid">
                  {w.days.map((d, i) => (
                    <div key={`${w.id}-${i}`} className="week-cell">
                      <div className="week-dow">{DOW_NAMES[i]}</div>
                      <div className="week-name">{d ? d.name : '—'}</div>
                      <div className="small muted mono">{d ? `${round(d.totals.kcal, 0)}` : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="template-macros num">
                {round(w.avgDailyTotals.kcal, 0).toLocaleString()} kcal
                <div className="small muted">avg/day</div>
              </div>
              <div className="row-tight">
                <button className="btn btn-sm" type="button" disabled={busy} onClick={() => onApplyWeek(w.id, replace)}>
                  Apply to week of {data.weekStart.slice(5)}
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={busy}
                  aria-label={`Delete ${w.name}`}
                  onClick={() => onDelete('weeks', w.id)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          {!data.library.weeks.length ? <div className="empty">No saved weeks yet.</div> : null}
        </div>
      ) : null}
    </Card>
  );
}

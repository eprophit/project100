import { getSetting, one, run, setSetting, tx } from './db';
import { FOODS } from './foods';
import { NUTRIENT_KEYS } from './nutrition';
import { simulate } from './sim/athlete';
import { MEAL_TEMPLATES, DAY_TEMPLATES, WEEK_TEMPLATES } from './templates';
import { DEFAULT_TARGETS } from './types';

/**
 * App-local data: the food catalog, the supplement stack and its adherence log,
 * and recovery-protocol entries.
 *
 * These are deliberately *not* behind connectors — nobody's sauna has an API.
 * They're user-owned records the app writes directly, so they're seeded once
 * with plausible history and then edited through the UI.
 */

const SEED_VERSION = '4';

interface SupplementSeed {
  id: string;
  name: string;
  brand?: string;
  dose: number;
  unit: string;
  timing: string;
  purpose: string;
  cadence?: string;
}

const SUPPLEMENTS: SupplementSeed[] = [
  { id: 's_creatine', name: 'Creatine monohydrate', dose: 5, unit: 'g', timing: 'post', purpose: 'Strength & power output' },
  { id: 's_vitd', name: 'Vitamin D3 + K2', dose: 4000, unit: 'IU', timing: 'with_meal', purpose: 'Serum 25-OH D was 27 ng/mL at baseline' },
  { id: 's_omega3', name: 'Omega-3 (EPA/DHA)', dose: 2, unit: 'g', timing: 'with_meal', purpose: 'Omega-3 index below 8%' },
  { id: 's_magnesium', name: 'Magnesium glycinate', dose: 400, unit: 'mg', timing: 'pm', purpose: 'Sleep quality & RBC magnesium' },
  { id: 's_whey', name: 'Whey isolate', dose: 30, unit: 'g', timing: 'post', purpose: 'Protein target on training days', cadence: 'training_days' },
  { id: 's_beta_alanine', name: 'Beta-alanine', dose: 3.2, unit: 'g', timing: 'pre', purpose: 'Buffering for 4-min erg intervals' },
  { id: 's_caffeine', name: 'Caffeine', dose: 200, unit: 'mg', timing: 'pre', purpose: 'Pre-session, hard days only', cadence: 'training_days' },
  { id: 's_b12', name: 'Vitamin B12 (methyl)', dose: 500, unit: 'mcg', timing: 'am', purpose: 'Homocysteine 11.8 µmol/L at baseline' },
  { id: 's_iron', name: 'Iron bisglycinate', dose: 25, unit: 'mg', timing: 'am', purpose: 'Ferritin at the low end of range', cadence: 'weekly' },
  { id: 's_electrolytes', name: 'Electrolytes (Na/K/Mg)', dose: 1, unit: 'sachet', timing: 'pre', purpose: 'Sweat losses on long sessions', cadence: 'training_days' },
];

export function needsSeed(): boolean {
  return getSetting('seed_version') !== SEED_VERSION;
}

/**
 * Starter meal / day / week templates.
 *
 * Each is inserted only if its id is absent, so bumping SEED_VERSION to add a
 * food never rewrites a template the user has since edited. Deleting a starter
 * template in the UI is likewise permanent within a seed version — it only
 * comes back if the version changes, which is the same contract the rest of
 * the seed has.
 *
 * Template items store the same per-100 g snapshot that log entries do, taken
 * from the catalog at seed time rather than joined at read time. A template is
 * a saved *amount of a specific food as it was understood then*; if the catalog
 * is later corrected, existing plans keep their numbers until re-added.
 */
function seedTemplates(): void {
  const now = new Date().toISOString();
  const catalog = new Map(FOODS.map((f) => [f.id, f]));

  const itemCols = NUTRIENT_KEYS.map((k) => `n_${k}`).join(', ');
  const itemPlaceholders = NUTRIENT_KEYS.map(() => '?').join(', ');

  for (const t of MEAL_TEMPLATES) {
    const existing = one<{ id: string }>('SELECT id FROM meal_templates WHERE id = ?', [t.id]);
    if (existing) continue;

    run(
      `INSERT INTO meal_templates (id, name, slot, notes, tags, created_at) VALUES (?,?,?,?,?,?)`,
      [t.id, t.name, t.slot, t.notes ?? null, t.tags ?? null, now],
    );

    for (const [position, item] of t.items.entries()) {
      const food = catalog.get(item.foodId);
      if (!food) continue; // A template naming a food we no longer ship just loses that line.

      run(
        `INSERT INTO meal_template_items
           (template_id, position, food_id, food, brand, quantity, unit, basis, serving_g, ${itemCols})
         VALUES (?,?,?,?,?,?, 'g', 'per_100g', ?, ${itemPlaceholders})`,
        [
          t.id, position, food.id, food.name, food.brand ?? null, item.grams, food.servingG,
          ...NUTRIENT_KEYS.map((k) => (food as unknown as Record<string, unknown>)[k] ?? 0),
        ],
      );
    }
  }

  for (const d of DAY_TEMPLATES) {
    const existing = one<{ id: string }>('SELECT id FROM day_templates WHERE id = ?', [d.id]);
    if (existing) continue;

    run(`INSERT INTO day_templates (id, name, notes, tags, created_at) VALUES (?,?,?,?,?)`, [
      d.id, d.name, d.notes ?? null, d.tags ?? null, now,
    ]);

    for (const [position, m] of d.meals.entries()) {
      run(
        `INSERT INTO day_template_meals (day_template_id, meal_template_id, slot, position)
         VALUES (?,?,?,?)`,
        [d.id, m.mealTemplateId, m.slot, position],
      );
    }
  }

  for (const w of WEEK_TEMPLATES) {
    const existing = one<{ id: string }>('SELECT id FROM week_templates WHERE id = ?', [w.id]);
    if (existing) continue;

    run(`INSERT INTO week_templates (id, name, notes, created_at) VALUES (?,?,?,?)`, [
      w.id, w.name, w.notes ?? null, now,
    ]);

    for (const [dow, dayTemplateId] of w.days.entries()) {
      run(
        `INSERT INTO week_template_days (week_template_id, dow, day_template_id) VALUES (?,?,?)`,
        [w.id, dow, dayTemplateId],
      );
    }
  }
}

/** Idempotent. Safe to call on every boot. */
export function seedLocal(): void {
  if (!needsSeed()) return;

  tx(() => {
    // Foods carry per-100 g values plus micronutrients; the column list is
    // derived from NUTRIENT_KEYS so adding a nutrient is a one-line change.
    const nutrientCols = NUTRIENT_KEYS.join(', ');
    const nutrientPlaceholders = NUTRIENT_KEYS.map(() => '?').join(', ');
    const nutrientUpdates = NUTRIENT_KEYS.map((k) => `${k}=excluded.${k}`).join(', ');

    for (const f of FOODS) {
      run(
        `INSERT INTO foods (id, name, brand, serving_label, serving_g, origin, tags, ${nutrientCols})
         VALUES (?,?,?,?,?,'catalog',?, ${nutrientPlaceholders})
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, brand=excluded.brand, serving_label=excluded.serving_label,
           serving_g=excluded.serving_g, tags=excluded.tags, ${nutrientUpdates}`,
        [
          f.id, f.name, f.brand ?? null, f.serving, f.servingG, f.tags,
          ...NUTRIENT_KEYS.map((k) => (f as unknown as Record<string, unknown>)[k] ?? 0),
        ],
      );
    }

    seedTemplates();

    const days = simulate();
    const startedOn = days[0]?.day ?? null;

    for (const s of SUPPLEMENTS) {
      run(
        `INSERT INTO supplements (id, name, brand, dose, unit, timing, purpose, cadence, active, started_on)
         VALUES (?,?,?,?,?,?,?,?,1,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, dose=excluded.dose, unit=excluded.unit, timing=excluded.timing,
           purpose=excluded.purpose, cadence=excluded.cadence`,
        [s.id, s.name, s.brand ?? null, s.dose, s.unit, s.timing, s.purpose, s.cadence ?? 'daily', startedOn],
      );
    }

    // Protocol history + adherence log.
    for (const d of days) {
      for (const [i, p] of d.protocols.entries()) {
        const id = `manual:${d.day}-${p.kind}-${i}`;
        run(
          `INSERT INTO protocols (id, source_id, external_id, day, kind, minutes, intensity, notes)
           VALUES (?, 'manual', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_id, external_id) DO NOTHING`,
          [id, `${d.day}-${p.kind}-${i}`, d.day, p.kind, p.minutes, p.intensity, p.notes ?? null],
        );
      }

      const trainedToday = d.sessions.length > 0;
      const skipAm = d.supplementsSkipped.includes('all-am');
      const skipPm = d.supplementsSkipped.includes('all-pm');

      for (const s of SUPPLEMENTS) {
        // Weekly items only land on Sundays; training-day items need a session.
        const dow = new Date(`${d.day}T00:00:00Z`).getUTCDay();
        if (s.cadence === 'weekly' && dow !== 0) continue;
        if (s.cadence === 'training_days' && !trainedToday) continue;

        const evening = s.timing === 'pm';
        const taken = evening ? !skipPm : !skipAm;
        run(
          `INSERT INTO supplement_logs (id, supplement_id, day, taken, dose, source_id)
           VALUES (?,?,?,?,?, 'manual')
           ON CONFLICT(supplement_id, day) DO NOTHING`,
          [`${s.id}:${d.day}`, s.id, d.day, taken ? 1 : 0, s.dose],
        );
      }
    }

    run(
      `INSERT INTO sources (id, name, vendor, domains, auth_mode, mode, last_status)
       VALUES ('manual', 'Manual log', 'Vitalis', '["protocols"]', 'file_export', 'demo', 'ok')
       ON CONFLICT(id) DO NOTHING`,
    );

    if (!getSetting('targets')) setSetting('targets', JSON.stringify(DEFAULT_TARGETS));
    setSetting('seed_version', SEED_VERSION);
  });
}

/** True once at least one connector has landed data. */
export function hasIngestedData(): boolean {
  const row = one<{ n: number }>('SELECT COUNT(*) AS n FROM workouts');
  return (row?.n ?? 0) > 0;
}

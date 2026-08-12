import { getSetting, one, run, setSetting, tx } from './db';
import { simulate } from './sim/athlete';
import { DEFAULT_TARGETS } from './types';

/**
 * App-local data: the food catalog, the supplement stack and its adherence log,
 * and recovery-protocol entries.
 *
 * These are deliberately *not* behind connectors — nobody's sauna has an API.
 * They're user-owned records the app writes directly, so they're seeded once
 * with plausible history and then edited through the UI.
 */

const SEED_VERSION = '3';

interface FoodSeed {
  id: string;
  name: string;
  brand?: string;
  serving: string;
  servingG?: number;
  kcal: number;
  p: number;
  c: number;
  f: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  tags: string;
}

const FOODS: FoodSeed[] = [
  { id: 'f_chicken_breast', name: 'Chicken breast, grilled', serving: '150 g', servingG: 150, kcal: 248, p: 46.5, c: 0, f: 5.4, sodium: 111, tags: 'protein,lean' },
  { id: 'f_salmon', name: 'Salmon fillet, baked', serving: '150 g', servingG: 150, kcal: 312, p: 34.5, c: 0, f: 18.6, sodium: 89, tags: 'protein,omega3' },
  { id: 'f_cod', name: 'Cod fillet, baked', serving: '150 g', servingG: 150, kcal: 158, p: 34.4, c: 0, f: 1.3, sodium: 105, tags: 'protein,lean' },
  { id: 'f_sirloin', name: 'Sirloin steak, lean', serving: '150 g', servingG: 150, kcal: 293, p: 42, c: 0, f: 13.5, sodium: 82, tags: 'protein,iron' },
  { id: 'f_ground_beef', name: 'Ground beef 90/10', serving: '150 g', servingG: 150, kcal: 267, p: 39, c: 0, f: 11.6, sodium: 96, tags: 'protein,iron' },
  { id: 'f_eggs', name: 'Whole eggs', serving: '3 large', servingG: 150, kcal: 234, p: 18.9, c: 1.2, f: 15.9, sodium: 213, tags: 'protein,breakfast' },
  { id: 'f_egg_whites', name: 'Egg whites', serving: '200 g', servingG: 200, kcal: 104, p: 21.6, c: 1.4, f: 0.3, sodium: 332, tags: 'protein,lean' },
  { id: 'f_greek_yogurt', name: 'Greek yogurt 2%', serving: '200 g', servingG: 200, kcal: 146, p: 20, c: 7.6, f: 4, sugar: 7.2, sodium: 68, tags: 'protein,breakfast' },
  { id: 'f_cottage_cheese', name: 'Cottage cheese 4%', serving: '150 g', servingG: 150, kcal: 147, p: 17, c: 5.1, f: 6.5, sodium: 465, tags: 'protein,casein' },
  { id: 'f_whey', name: 'Whey isolate', brand: 'Generic', serving: '1 scoop (30 g)', servingG: 30, kcal: 113, p: 25, c: 1.5, f: 0.6, sodium: 55, tags: 'protein,supplement' },
  { id: 'f_oats', name: 'Rolled oats, dry', serving: '80 g', servingG: 80, kcal: 303, p: 10.6, c: 54.4, f: 5.3, fiber: 8.1, tags: 'carb,breakfast' },
  { id: 'f_white_rice', name: 'White rice, cooked', serving: '200 g', servingG: 200, kcal: 260, p: 5.4, c: 56.4, f: 0.6, fiber: 0.8, tags: 'carb' },
  { id: 'f_brown_rice', name: 'Brown rice, cooked', serving: '200 g', servingG: 200, kcal: 246, p: 5.2, c: 51.2, f: 1.8, fiber: 3.2, tags: 'carb,fiber' },
  { id: 'f_quinoa', name: 'Quinoa, cooked', serving: '185 g', servingG: 185, kcal: 222, p: 8.1, c: 39.4, f: 3.6, fiber: 5.2, tags: 'carb,fiber' },
  { id: 'f_sweet_potato', name: 'Sweet potato, roasted', serving: '200 g', servingG: 200, kcal: 180, p: 4, c: 41.4, f: 0.2, fiber: 6.6, sugar: 12.8, tags: 'carb,fiber' },
  { id: 'f_potato', name: 'Potatoes, boiled', serving: '250 g', servingG: 250, kcal: 218, p: 5, c: 49.5, f: 0.3, fiber: 5, tags: 'carb' },
  { id: 'f_pasta', name: 'Wholewheat pasta, cooked', serving: '180 g', servingG: 180, kcal: 224, p: 9.4, c: 43.2, f: 1.6, fiber: 6.3, tags: 'carb,fiber' },
  { id: 'f_sourdough', name: 'Sourdough bread', serving: '2 slices', servingG: 90, kcal: 234, p: 8.5, c: 45, f: 1.7, fiber: 2.4, sodium: 468, tags: 'carb' },
  { id: 'f_banana', name: 'Banana', serving: '1 medium', servingG: 118, kcal: 105, p: 1.3, c: 27, f: 0.4, fiber: 3.1, sugar: 14.4, tags: 'carb,fruit' },
  { id: 'f_berries', name: 'Mixed berries', serving: '150 g', servingG: 150, kcal: 84, p: 1.2, c: 19.5, f: 0.6, fiber: 5.4, sugar: 12, tags: 'fruit,fiber' },
  { id: 'f_apple', name: 'Apple', serving: '1 medium', servingG: 182, kcal: 95, p: 0.5, c: 25, f: 0.3, fiber: 4.4, sugar: 19, tags: 'fruit,fiber' },
  { id: 'f_broccoli', name: 'Broccoli, steamed', serving: '200 g', servingG: 200, kcal: 70, p: 5.6, c: 13.6, f: 0.8, fiber: 5.2, tags: 'veg,fiber' },
  { id: 'f_spinach', name: 'Spinach, raw', serving: '100 g', servingG: 100, kcal: 23, p: 2.9, c: 3.6, f: 0.4, fiber: 2.2, sodium: 79, tags: 'veg,fiber,iron' },
  { id: 'f_mixed_salad', name: 'Mixed leaf salad', serving: '150 g', servingG: 150, kcal: 27, p: 2, c: 4.5, f: 0.4, fiber: 2.7, tags: 'veg,fiber' },
  { id: 'f_avocado', name: 'Avocado', serving: '1/2 medium', servingG: 100, kcal: 160, p: 2, c: 8.5, f: 14.7, fiber: 6.7, tags: 'fat,fiber' },
  { id: 'f_olive_oil', name: 'Olive oil', serving: '1 tbsp', servingG: 14, kcal: 119, p: 0, c: 0, f: 13.5, tags: 'fat' },
  { id: 'f_almonds', name: 'Almonds', serving: '30 g', servingG: 30, kcal: 174, p: 6.4, c: 6.1, f: 15, fiber: 3.8, tags: 'fat,fiber,snack' },
  { id: 'f_peanut_butter', name: 'Peanut butter', serving: '2 tbsp', servingG: 32, kcal: 190, p: 8, c: 6.4, f: 16, fiber: 1.9, sodium: 136, tags: 'fat,snack' },
  { id: 'f_lentils', name: 'Lentils, cooked', serving: '200 g', servingG: 200, kcal: 232, p: 18, c: 40, f: 0.8, fiber: 15.8, tags: 'protein,carb,fiber' },
  { id: 'f_black_beans', name: 'Black beans, cooked', serving: '175 g', servingG: 175, kcal: 227, p: 15.2, c: 40.8, f: 0.9, fiber: 15, sodium: 2, tags: 'protein,carb,fiber' },
  { id: 'f_tofu', name: 'Firm tofu', serving: '150 g', servingG: 150, kcal: 173, p: 19.5, c: 4.2, f: 10.4, fiber: 2.7, tags: 'protein,plant' },
  { id: 'f_protein_bar', name: 'Protein bar', brand: 'Generic', serving: '1 bar (60 g)', servingG: 60, kcal: 214, p: 20, c: 22, f: 7, fiber: 6, sugar: 3, sodium: 180, tags: 'protein,snack' },
  { id: 'f_choc_milk', name: 'Chocolate milk', serving: '400 ml', kcal: 260, p: 13.6, c: 41.6, f: 4, sugar: 39.2, sodium: 200, tags: 'carb,protein,recovery' },
  { id: 'f_sports_drink', name: 'Electrolyte drink', serving: '500 ml', kcal: 90, p: 0, c: 22, f: 0, sugar: 22, sodium: 380, tags: 'carb,intra' },
  { id: 'f_honey', name: 'Honey', serving: '1 tbsp', servingG: 21, kcal: 64, p: 0.1, c: 17.3, f: 0, sugar: 17.2, tags: 'carb' },
  { id: 'f_dark_choc', name: 'Dark chocolate 85%', serving: '25 g', servingG: 25, kcal: 145, p: 2.5, c: 8, f: 12, fiber: 3, sugar: 3.5, tags: 'snack,fat' },
  { id: 'f_kefir', name: 'Kefir, plain', serving: '250 ml', kcal: 160, p: 9, c: 12, f: 8, sugar: 12, sodium: 125, tags: 'protein,gut' },
  { id: 'f_sauerkraut', name: 'Sauerkraut', serving: '75 g', servingG: 75, kcal: 14, p: 0.7, c: 3.2, f: 0.1, fiber: 2.1, sodium: 495, tags: 'veg,gut' },
  { id: 'f_beetroot', name: 'Beetroot, cooked', serving: '150 g', servingG: 150, kcal: 66, p: 2.4, c: 14.7, f: 0.3, fiber: 3, sugar: 10.5, sodium: 116, tags: 'veg,nitrate' },
  { id: 'f_walnuts', name: 'Walnuts', serving: '30 g', servingG: 30, kcal: 196, p: 4.6, c: 4.1, f: 19.6, fiber: 2, tags: 'fat,omega3' },
];

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

/** Idempotent. Safe to call on every boot. */
export function seedLocal(): void {
  if (!needsSeed()) return;

  tx(() => {
    for (const f of FOODS) {
      run(
        `INSERT INTO foods (id, name, brand, serving, serving_g, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, tags)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, brand=excluded.brand, serving=excluded.serving,
           serving_g=excluded.serving_g, kcal=excluded.kcal, protein_g=excluded.protein_g,
           carbs_g=excluded.carbs_g, fat_g=excluded.fat_g, fiber_g=excluded.fiber_g,
           sugar_g=excluded.sugar_g, sodium_mg=excluded.sodium_mg, tags=excluded.tags`,
        [f.id, f.name, f.brand ?? null, f.serving, f.servingG ?? null, f.kcal, f.p, f.c, f.f,
         f.fiber ?? 0, f.sugar ?? 0, f.sodium ?? 0, f.tags],
      );
    }

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

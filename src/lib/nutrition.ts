/**
 * Nutrient maths.
 *
 * Everything in the food catalog is stored **per 100 g**, which is the only
 * basis that makes grams / ounces / servings interchangeable: a serving is just
 * a named number of grams, so switching units is a pure conversion rather than
 * a re-entry of the item.
 *
 * Entries that came from an upstream log (a MyFitnessPal composite like
 * "Salmon poke bowl") have no weight attached, so they carry a per-serving
 * snapshot instead and are marked as such. Those can still have their quantity
 * edited; they just cannot be re-expressed in grams, because nothing knows what
 * one of them weighs.
 */

export const GRAMS_PER_OZ = 28.349523125;

export type Unit = 'g' | 'oz' | 'serving';
export const UNITS: Unit[] = ['g', 'oz', 'serving'];

export type Basis = 'per_100g' | 'per_serving';

/** The nutrient vector carried by foods, entries and totals alike. */
export interface Nutrients {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sat_fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
  potassium_mg: number;
  calcium_mg: number;
  iron_mg: number;
  magnesium_mg: number;
  zinc_mg: number;
  vit_a_mcg: number;
  vit_c_mg: number;
  vit_d_mcg: number;
  vit_b12_mcg: number;
  folate_mcg: number;
  cholesterol_mg: number;
  omega3_g: number;
}

export const NUTRIENT_KEYS = [
  'kcal', 'protein_g', 'carbs_g', 'fat_g', 'sat_fat_g', 'fiber_g', 'sugar_g',
  'sodium_mg', 'potassium_mg', 'calcium_mg', 'iron_mg', 'magnesium_mg', 'zinc_mg',
  'vit_a_mcg', 'vit_c_mg', 'vit_d_mcg', 'vit_b12_mcg', 'folate_mcg',
  'cholesterol_mg', 'omega3_g',
] as const satisfies readonly (keyof Nutrients)[];

export const ZERO_NUTRIENTS: Nutrients = Object.fromEntries(
  NUTRIENT_KEYS.map((k) => [k, 0]),
) as unknown as Nutrients;

/** Display metadata for the food-detail panel. */
export const NUTRIENT_META: {
  key: keyof Nutrients;
  label: string;
  unit: string;
  group: 'macro' | 'carb' | 'fat' | 'mineral' | 'vitamin' | 'other';
  /** Reference daily intake, for the "% of RDI" column. */
  rdi?: number;
  dp: number;
}[] = [
  { key: 'kcal', label: 'Energy', unit: 'kcal', group: 'macro', dp: 0 },
  { key: 'protein_g', label: 'Protein', unit: 'g', group: 'macro', rdi: 130, dp: 1 },
  { key: 'carbs_g', label: 'Carbohydrate', unit: 'g', group: 'macro', rdi: 275, dp: 1 },
  { key: 'fat_g', label: 'Fat', unit: 'g', group: 'macro', rdi: 78, dp: 1 },
  { key: 'fiber_g', label: 'Fibre', unit: 'g', group: 'carb', rdi: 38, dp: 1 },
  { key: 'sugar_g', label: 'Sugars', unit: 'g', group: 'carb', dp: 1 },
  { key: 'sat_fat_g', label: 'Saturated fat', unit: 'g', group: 'fat', rdi: 20, dp: 1 },
  { key: 'omega3_g', label: 'Omega-3', unit: 'g', group: 'fat', rdi: 1.6, dp: 2 },
  { key: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg', group: 'fat', rdi: 300, dp: 0 },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg', group: 'mineral', rdi: 2300, dp: 0 },
  { key: 'potassium_mg', label: 'Potassium', unit: 'mg', group: 'mineral', rdi: 3400, dp: 0 },
  { key: 'calcium_mg', label: 'Calcium', unit: 'mg', group: 'mineral', rdi: 1000, dp: 0 },
  { key: 'iron_mg', label: 'Iron', unit: 'mg', group: 'mineral', rdi: 8, dp: 2 },
  { key: 'magnesium_mg', label: 'Magnesium', unit: 'mg', group: 'mineral', rdi: 420, dp: 0 },
  { key: 'zinc_mg', label: 'Zinc', unit: 'mg', group: 'mineral', rdi: 11, dp: 2 },
  { key: 'vit_a_mcg', label: 'Vitamin A', unit: 'µg', group: 'vitamin', rdi: 900, dp: 0 },
  { key: 'vit_c_mg', label: 'Vitamin C', unit: 'mg', group: 'vitamin', rdi: 90, dp: 1 },
  { key: 'vit_d_mcg', label: 'Vitamin D', unit: 'µg', group: 'vitamin', rdi: 20, dp: 1 },
  { key: 'vit_b12_mcg', label: 'Vitamin B12', unit: 'µg', group: 'vitamin', rdi: 2.4, dp: 2 },
  { key: 'folate_mcg', label: 'Folate', unit: 'µg', group: 'vitamin', rdi: 400, dp: 0 },
];

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/** Grams for a quantity, or null when the entry has no known weight. */
export function toGrams(quantity: number, unit: Unit, servingG: number | null): number | null {
  switch (unit) {
    case 'g':
      return quantity;
    case 'oz':
      return quantity * GRAMS_PER_OZ;
    case 'serving':
      return servingG != null ? quantity * servingG : null;
  }
}

/** Converts a quantity between units, keeping the same absolute amount. */
export function convertQuantity(
  quantity: number,
  from: Unit,
  to: Unit,
  servingG: number | null,
): number | null {
  if (from === to) return quantity;
  const grams = toGrams(quantity, from, servingG);
  if (grams == null) return null;
  switch (to) {
    case 'g':
      return round(grams, 1);
    case 'oz':
      return round(grams / GRAMS_PER_OZ, 2);
    case 'serving':
      return servingG != null && servingG > 0 ? round(grams / servingG, 2) : null;
  }
}

/** Which units an entry can legitimately be expressed in. */
export function availableUnits(basis: Basis, servingG: number | null): Unit[] {
  if (basis === 'per_serving') return ['serving'];
  return servingG != null && servingG > 0 ? ['g', 'oz', 'serving'] : ['g', 'oz'];
}

export function scale(nutrients: Nutrients, factor: number): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) out[k] = round(nutrients[k] * factor, 4);
  return out;
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) out[k] = round(a[k] + b[k], 4);
  return out;
}

export function sumNutrients(items: Nutrients[]): Nutrients {
  return items.reduce<Nutrients>((acc, n) => addNutrients(acc, n), { ...ZERO_NUTRIENTS });
}

/**
 * Resolves an entry's actual nutrients from its stored basis and quantity.
 *
 * `basis === 'per_100g'` means the snapshot is per 100 grams and the quantity
 * converts to grams; `'per_serving'` means the snapshot is one serving and the
 * quantity is a multiplier.
 */
export function resolveNutrients(entry: {
  quantity: number;
  unit: Unit;
  basis: Basis;
  serving_g: number | null;
  base: Nutrients;
}): Nutrients {
  if (entry.basis === 'per_serving') return scale(entry.base, entry.quantity);
  const grams = toGrams(entry.quantity, entry.unit, entry.serving_g);
  if (grams == null) return { ...ZERO_NUTRIENTS };
  return scale(entry.base, grams / 100);
}

/**
 * `resolveNutrients`' multiplier, expressed in SQL.
 *
 * Range aggregates — a month of calories, target adherence, the metric catalog
 * — would otherwise have to pull every entry into JS to apply the conversion.
 * It lives beside its TypeScript twin because the two must stay in agreement;
 * `npm run check` compares them on real rows.
 *
 * Assumes the standard nutrition_entries / meal_template_items column names.
 */
export const FACTOR_SQL = `(CASE
  WHEN basis = 'per_100g' THEN
    (CASE unit
       WHEN 'g'  THEN quantity
       WHEN 'oz' THEN quantity * ${GRAMS_PER_OZ}
       ELSE quantity * COALESCE(serving_g, 0)
     END) / 100.0
  ELSE quantity
END)`;

/** Human label for an amount, e.g. "150 g", "5.3 oz", "1.5 × 200 g". */
export function formatAmount(quantity: number, unit: Unit, servingG: number | null): string {
  const q = round(quantity, 2);
  if (unit === 'g') return `${q} g`;
  if (unit === 'oz') return `${q} oz`;
  return servingG ? `${q} × ${round(servingG, 0)} g` : `${q} serving${q === 1 ? '' : 's'}`;
}

export function round(v: number, dp = 1): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Pulls the nutrient vector out of a wider row (a food or an entry). */
export function pickNutrients(row: Record<string, unknown>, prefix = ''): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) out[k] = Number(row[`${prefix}${k}`] ?? 0);
  return out;
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'intra'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_LABEL: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  intra: 'Intra-workout',
};

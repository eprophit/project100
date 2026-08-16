import { CsvTable, parseCsv, parseDayKey } from '../imports/csv';
import { simDayMap } from '../sim/athlete';
import { daysInWindow, pageWindow, simulateCall } from './transport';
import {
  type Connector,
  type FetchContext,
  type FetchPage,
  type ImportFile,
  type NormalizedBatch,
  type NutritionInput,
} from './types';

/**
 * MyFitnessPal.
 *
 * Wire quirks absorbed here:
 *  - a day is one document with nested `meals[].entries[]`; entries have no
 *    day of their own.
 *  - nutrients live under `nutritional_contents` keyed by nutrient name, with
 *    sodium in **milligrams** and everything else in grams.
 *  - `servings` multiplies the per-serving nutrients, which are stored
 *    *pre-multiplication*.
 */

const PAGE_DAYS = 90;

interface MfpEntry {
  id: string;
  food: { description: string; brand_name?: string | null; serving_size: string };
  servings: number;
  nutritional_contents: {
    energy: { value: number; unit: 'calories' };
    protein: number;
    carbohydrates: number;
    fat: number;
    saturated_fat: number;
    fiber: number;
    sugar: number;
    sodium: number; // mg
    potassium: number; // mg
    calcium: number; // % of daily value, as MFP reports it
    iron: number; // % of daily value
    vitamin_a: number; // % of daily value
    vitamin_c: number; // % of daily value
    cholesterol: number; // mg
  };
  logged_at: string;
}

interface MfpDay {
  date: string;
  meals: { name: string; entries: MfpEntry[] }[];
  goals: { energy: { value: number }; protein: number; carbohydrates: number; fat: number };
}

export const myfitnesspal: Connector = {
  id: 'myfitnesspal',
  name: 'MyFitnessPal',
  vendor: 'MyFitnessPal, Inc.',
  domains: ['nutrition'],
  authMode: 'oauth',
  credentialEnv: 'MYFITNESSPAL_TOKEN',
  liveVia: 'file_import',
  integrationNote:
    'The MyFitnessPal API is closed to new developers, so real data comes from their CSV export. Upload it here, or set MYFITNESSPAL_TOKEN to a folder path and exports dropped there are ingested on the next sync.',
  backfillDays: 400,

  fileImport: {
    instructions:
      'myfitnesspal.com → Settings → Export Data → request a "Nutrition" CSV for the date range you want. It arrives by email; upload the CSV here.',
    accept: ['.csv'],
    matches(file) {
      const head = file.head.toLowerCase();
      if (!/\.csv$/i.test(file.filename)) return false;
      // Distinguish from the lab and HRV CSVs by the columns only a food diary
      // has: a meal name alongside macros.
      return head.includes('meal') && (head.includes('calorie') || head.includes('energy'));
    },
    async parse(file) {
      return { nutrition: parseDiaryCsv(await file.text()) };
    },
  },

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    const window = pageWindow(ctx.since, ctx.cursor, PAGE_DAYS);
    await simulateCall('myfitnesspal', window, ctx.attempt);

    const sim = simDayMap();
    const records: MfpDay[] = [];

    for (const day of daysInWindow(window)) {
      const d = sim.get(day);
      if (!d) continue;

      const byMeal = new Map<string, MfpEntry[]>();
      d.nutrition.forEach((n, i) => {
        const mealName = n.meal[0].toUpperCase() + n.meal.slice(1);
        const list = byMeal.get(mealName) ?? [];
        list.push({
          id: `${day}-${i}`,
          food: { description: n.food, brand_name: n.brand ?? null, serving_size: '1 serving' },
          servings: n.servings,
          nutritional_contents: {
            // Stored per serving; `servings` is the multiplier.
            energy: { value: n.kcal / n.servings, unit: 'calories' },
            protein: n.protein / n.servings,
            carbohydrates: n.carbs / n.servings,
            fat: n.fat / n.servings,
            saturated_fat: (n.fat * 0.31) / n.servings,
            fiber: n.fiber / n.servings,
            sugar: n.sugar / n.servings,
            sodium: n.sodium / n.servings,
            potassium: (n.kcal * 0.52) / n.servings,
            calcium: Math.round((n.kcal / 28) / n.servings),
            iron: Math.round((n.kcal / 24) / n.servings),
            vitamin_a: Math.round((n.kcal / 40) / n.servings),
            vitamin_c: Math.round((n.kcal / 22) / n.servings),
            cholesterol: (n.protein * 1.4) / n.servings,
          },
          logged_at: `${day}T12:00:00Z`,
        });
        byMeal.set(mealName, list);
      });

      records.push({
        date: day,
        meals: [...byMeal.entries()].map(([name, entries]) => ({ name, entries })),
        goals: { energy: { value: 2900 }, protein: 175, carbohydrates: 340, fat: 90 },
      });
    }

    return { records, nextCursor: window.nextCursor };
  },

  normalize(records: unknown[]): NormalizedBatch {
    const nutrition: NutritionInput[] = [];

    for (const doc of records as MfpDay[]) {
      for (const meal of doc.meals) {
        for (const entry of meal.entries) {
          const n = entry.nutritional_contents;
          const mult = entry.servings;
          nutrition.push({
            externalId: entry.id,
            day: doc.date,
            meal: meal.name.toLowerCase(),
            food: entry.food.description,
            brand: entry.food.brand_name ?? undefined,
            servings: mult,
            // MFP diary entries carry no weight — a "bowl" is not a number of
            // grams — so downstream these stay per-serving and cannot be
            // re-expressed in g or oz.
            servingG: null,
            kcal: Math.round(n.energy.value * mult),
            proteinG: round1(n.protein * mult),
            carbsG: round1(n.carbohydrates * mult),
            fatG: round1(n.fat * mult),
            satFatG: round1(n.saturated_fat * mult),
            fiberG: round1(n.fiber * mult),
            sugarG: round1(n.sugar * mult),
            sodiumMg: Math.round(n.sodium * mult),
            potassiumMg: Math.round(n.potassium * mult),
            // MFP reports these as a percentage of a daily value, not an
            // absolute amount; convert back using the same reference values
            // the app displays against.
            calciumMg: Math.round(pctOfDv(n.calcium, 1000) * mult),
            ironMg: round1(pctOfDv(n.iron, 8) * mult),
            vitAMcg: Math.round(pctOfDv(n.vitamin_a, 900) * mult),
            vitCMg: round1(pctOfDv(n.vitamin_c, 90) * mult),
            cholesterolMg: Math.round(n.cholesterol * mult),
            loggedAt: entry.logged_at,
          });
        }
      }
    }

    return { nutrition };
  },
};

/**
 * Parses a MyFitnessPal "Nutrition" CSV export into diary entries.
 *
 * The export is one row per logged food with the totals already multiplied out,
 * which is simpler than the API shape — but it still carries no serving weight,
 * so entries land per-serving and stay un-convertible to grams, exactly as the
 * API path does. Columns are matched loosely because MFP has renamed them
 * across export versions and localises some of them.
 */
export function parseDiaryCsv(text: string): NutritionInput[] {
  const table = new CsvTable(parseCsv(text));
  const out: NutritionInput[] = [];
  const perDay = new Map<string, number>();

  for (const row of table.rows) {
    const day = parseDayKey(table.cell(row, 'date', 'day'));
    if (!day) continue;

    const food = table.cell(row, 'food', 'foodname', 'item', 'description');
    if (!food) continue;

    const kcal = table.num(row, 'calories', 'energy', 'kcal') ?? 0;
    const mealRaw = table.cell(row, 'meal', 'mealname') || 'snack';

    // The export has no per-row id, so the natural key is position within the
    // day. Stable as long as the same range is re-exported, which is what makes
    // re-importing an overlapping export update rather than duplicate.
    const n = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, n);

    out.push({
      externalId: `csv:${day}:${n}`,
      day,
      meal: normalizeMeal(mealRaw),
      food,
      brand: table.cell(row, 'brand') || undefined,
      servings: 1,
      servingG: null, // a diary row is a composite with no weight
      kcal,
      proteinG: table.num(row, 'protein') ?? 0,
      carbsG: table.num(row, 'carbohydrates', 'carbs', 'carbohydrate') ?? 0,
      fatG: table.num(row, 'fat', 'totalfat') ?? 0,
      satFatG: table.num(row, 'saturatedfat'),
      fiberG: table.num(row, 'fiber', 'fibre'),
      sugarG: table.num(row, 'sugar', 'sugars'),
      sodiumMg: table.num(row, 'sodium'),
      potassiumMg: table.num(row, 'potassium'),
      calciumMg: table.num(row, 'calcium'),
      ironMg: table.num(row, 'iron'),
      vitAMcg: table.num(row, 'vitamina'),
      vitCMg: table.num(row, 'vitaminc'),
      cholesterolMg: table.num(row, 'cholesterol'),
      loggedAt: table.cell(row, 'time') ? `${day}T${padTime(table.cell(row, 'time'))}` : undefined,
    });
  }

  return out;
}

const MEAL_ALIASES: Record<string, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  supper: 'dinner',
  snack: 'snack',
  snacks: 'snack',
  'pre workout': 'intra',
  'intra workout': 'intra',
};

function normalizeMeal(raw: string): string {
  const key = raw.trim().toLowerCase();
  return MEAL_ALIASES[key] ?? (key || 'snack');
}

function padTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return '12:00:00Z';
  return `${m[1].padStart(2, '0')}:${m[2]}:00Z`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** MFP publishes several micronutrients as % of a daily value. */
function pctOfDv(pct: number, dailyValue: number): number {
  return (pct / 100) * dailyValue;
}

import { simDayMap } from '../sim/athlete';
import { daysInWindow, pageWindow, simulateCall } from './transport';
import {
  NotConfiguredError,
  type Connector,
  type FetchContext,
  type FetchPage,
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
    fiber: number;
    sugar: number;
    sodium: number; // mg
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
  integrationNote:
    'Live mode calls GET /v2/diary?entry_date__range={from}..{to} with a bearer token, one document per day.',
  backfillDays: 400,

  async fetchPage(ctx: FetchContext): Promise<FetchPage> {
    if (process.env.MYFITNESSPAL_TOKEN) throw new NotConfiguredError('myfitnesspal', 'MYFITNESSPAL_TOKEN');

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
            fiber: n.fiber / n.servings,
            sugar: n.sugar / n.servings,
            sodium: n.sodium / n.servings,
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
            kcal: Math.round(n.energy.value * mult),
            proteinG: round1(n.protein * mult),
            carbsG: round1(n.carbohydrates * mult),
            fatG: round1(n.fat * mult),
            fiberG: round1(n.fiber * mult),
            sugarG: round1(n.sugar * mult),
            sodiumMg: Math.round(n.sodium * mult),
            loggedAt: entry.logged_at,
          });
        }
      }
    }

    return { nutrition };
  },
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

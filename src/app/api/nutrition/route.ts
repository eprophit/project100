import { NextResponse } from 'next/server';
import { ensureReady } from '@/lib/bootstrap';
import { one, run, setSetting } from '@/lib/db';
import { today } from '@/lib/dates';
import { nutritionDay, searchFoods } from '@/lib/queries';
import type { Food, MacroTargets } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?day=YYYY-MM-DD  → the day's log, plan, totals and targets. */
export async function GET(request: Request) {
  await ensureReady();
  const url = new URL(request.url);

  if (url.searchParams.has('foods')) {
    return NextResponse.json({ foods: searchFoods(url.searchParams.get('foods') ?? '') });
  }

  const day = url.searchParams.get('day') ?? today();
  return NextResponse.json(nutritionDay(day));
}

/**
 * POST — add an entry to the log or the plan.
 * Body: { day, meal, foodId?, food?, servings, planned?, macros? }
 */
export async function POST(request: Request) {
  await ensureReady();

  const body = (await request.json()) as {
    day?: string;
    meal?: string;
    foodId?: string;
    food?: string;
    servings?: number;
    planned?: boolean;
    kcal?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    fiber_g?: number;
    sodium_mg?: number;
  };

  const day = body.day ?? today();
  const meal = body.meal ?? 'snack';
  const servings = Number(body.servings) || 1;
  const planned = body.planned ? 1 : 0;

  let macros = {
    food: body.food ?? 'Custom entry',
    brand: null as string | null,
    kcal: Number(body.kcal) || 0,
    protein_g: Number(body.protein_g) || 0,
    carbs_g: Number(body.carbs_g) || 0,
    fat_g: Number(body.fat_g) || 0,
    fiber_g: Number(body.fiber_g) || 0,
    sugar_g: 0,
    sodium_mg: Number(body.sodium_mg) || 0,
  };

  if (body.foodId) {
    const food = one<Food>('SELECT * FROM foods WHERE id = ?', [body.foodId]);
    if (!food) return NextResponse.json({ error: 'Unknown food' }, { status: 400 });
    macros = {
      food: food.name,
      brand: food.brand,
      kcal: food.kcal,
      protein_g: food.protein_g,
      carbs_g: food.carbs_g,
      fat_g: food.fat_g,
      fiber_g: food.fiber_g,
      sugar_g: food.sugar_g,
      sodium_mg: food.sodium_mg,
    };
  }

  const externalId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const id = `local:${externalId}`;

  run(
    `INSERT INTO nutrition_entries (id, source_id, external_id, day, meal, food, brand, servings,
        kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, planned, logged_at)
     VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, externalId, day, meal, macros.food, macros.brand, servings,
      round(macros.kcal * servings), round(macros.protein_g * servings, 1),
      round(macros.carbs_g * servings, 1), round(macros.fat_g * servings, 1),
      round(macros.fiber_g * servings, 1), round(macros.sugar_g * servings, 1),
      round(macros.sodium_mg * servings), planned, new Date().toISOString(),
    ],
  );

  return NextResponse.json(nutritionDay(day));
}

/** DELETE ?id=  — removes a log or plan entry. */
export async function DELETE(request: Request) {
  await ensureReady();
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const row = one<{ day: string }>('SELECT day FROM nutrition_entries WHERE id = ?', [id]);
  run('DELETE FROM nutrition_entries WHERE id = ?', [id]);
  return NextResponse.json(nutritionDay(row?.day ?? today()));
}

/** PATCH — update macro targets. */
export async function PATCH(request: Request) {
  await ensureReady();
  const body = (await request.json()) as { targets?: Partial<MacroTargets>; day?: string };
  if (body.targets) {
    const current = nutritionDay(today()).targets;
    setSetting('targets', JSON.stringify({ ...current, ...body.targets }));
  }
  return NextResponse.json(nutritionDay(body.day ?? today()));
}

function round(v: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

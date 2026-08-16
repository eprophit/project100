import { NextResponse } from 'next/server';
import { ensureReady } from '@/lib/bootstrap';
import { setSetting } from '@/lib/db';
import { addDays, today, weekStart, type DayKey } from '@/lib/dates';
import {
  addEntry,
  applyDayTemplate,
  applyMealTemplate,
  applyWeekTemplate,
  clearLocalEntries,
  createWeekTemplate,
  deleteDayTemplate,
  deleteEntry,
  deleteMealTemplate,
  deleteWeekTemplate,
  entriesForDay,
  getFood,
  groupIntoMeals,
  listDayTemplates,
  listMealTemplates,
  listWeekTemplates,
  saveDayAsTemplate,
  saveMealAsTemplate,
  saveWeekAsTemplate,
  searchFoodCatalog,
  updateEntryAmount,
  updateMealTemplateItem,
} from '@/lib/mealPlans';
import { sumNutrients, type Unit } from '@/lib/nutrition';
import { getTargets } from '@/lib/queries';
import type { NutritionPayload } from '@/app/nutrition/payload';
import { syncSource } from '@/lib/sync/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One endpoint for the whole nutrition tab.
 *
 * Every mutation returns the same full payload the page was rendered from, so
 * the client applies one state update rather than reconciling a patch — a day
 * has at most a few dozen entries, and applying a week template touches seven
 * days at once, which is exactly the case a patch protocol would get wrong.
 */

function payload(day: DayKey, planned: boolean): NutritionPayload {
  const entries = entriesForDay(day, planned);
  const start = weekStart(day);

  return {
    day,
    weekStart: start,
    planned,
    entries,
    meals: groupIntoMeals(entries),
    totals: sumNutrients(entries.map((e) => e.nutrients)),
    targets: getTargets(),
    week: Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const dayEntries = entriesForDay(d, planned);
      return {
        day: d,
        totals: sumNutrients(dayEntries.map((e) => e.nutrients)),
        count: dayEntries.length,
      };
    }),
    library: {
      meals: listMealTemplates(),
      days: listDayTemplates(),
      weeks: listWeekTemplates(),
    },
  };
}

function asUnit(v: unknown): Unit {
  return v === 'g' || v === 'oz' || v === 'serving' ? v : 'g';
}

/**
 * GET
 *   ?day=&planned=      the day, its week strip, and the template library
 *   ?foods=<query>      catalog search
 *   ?food=<id>          one food's full nutrient panel
 */
export async function GET(request: Request) {
  await ensureReady();
  const url = new URL(request.url);

  if (url.searchParams.has('foods')) {
    return NextResponse.json({ foods: searchFoodCatalog(url.searchParams.get('foods') ?? '') });
  }

  if (url.searchParams.has('food')) {
    const food = getFood(url.searchParams.get('food') ?? '');
    if (!food) return NextResponse.json({ error: 'Unknown food' }, { status: 404 });
    return NextResponse.json({ food });
  }

  return NextResponse.json(
    payload(url.searchParams.get('day') ?? today(), url.searchParams.get('planned') === '1'),
  );
}

/** POST — every mutation, discriminated by `action`. */
export async function POST(request: Request) {
  await ensureReady();
  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action ?? '');

  const day = String(body.day ?? today());
  const planned = body.planned === true;

  try {
    switch (action) {
      case 'add':
        addEntry({
          day,
          slot: String(body.slot ?? 'snack'),
          planned,
          foodId: String(body.foodId ?? ''),
          quantity: Number(body.quantity) || 0,
          unit: asUnit(body.unit),
        });
        break;

      case 'amount':
        updateEntryAmount(String(body.id), Number(body.quantity) || 0, asUnit(body.unit));
        break;

      case 'delete':
        deleteEntry(String(body.id));
        break;

      case 'clear':
        clearLocalEntries(day, planned, body.slot ? String(body.slot) : undefined);
        break;

      case 'copyDay': {
        // "Same as yesterday" — the single most common action for someone who
        // eats the same food most days, so it gets its own verb rather than
        // making the user save a template first.
        const from = String(body.from ?? addDays(day, -1));
        const source = entriesForDay(from, planned);
        if (!source.length) throw new Error(`Nothing logged on ${from} to copy.`);
        if (body.replace) clearLocalEntries(day, planned);
        for (const e of source) {
          addEntry({
            day,
            slot: e.meal,
            planned,
            foodId: e.food_id ?? undefined,
            quantity: e.quantity,
            unit: e.unit,
            custom: e.food_id
              ? undefined
              : { name: e.food, brand: e.brand ?? undefined, nutrients: e.base, basis: e.basis, servingG: e.serving_g },
          });
        }
        break;
      }

      case 'applyMeal':
        applyMealTemplate({
          templateId: String(body.templateId),
          day,
          slot: body.slot ? String(body.slot) : undefined,
          planned,
          replace: body.replace === true,
        });
        break;

      case 'applyDay':
        applyDayTemplate({
          templateId: String(body.templateId),
          day,
          planned,
          replace: body.replace === true,
        });
        break;

      case 'applyWeek':
        applyWeekTemplate({
          templateId: String(body.templateId),
          startDay: String(body.startDay ?? weekStart(day)),
          planned,
          replace: body.replace === true,
        });
        break;

      case 'saveMeal':
        saveMealAsTemplate(day, String(body.slot ?? 'snack'), planned, String(body.name ?? 'Saved meal'));
        break;

      case 'saveDay':
        saveDayAsTemplate({
          day,
          planned,
          name: String(body.name ?? 'Saved day'),
          notes: body.notes ? String(body.notes) : undefined,
        });
        break;

      case 'saveWeek':
        saveWeekAsTemplate({
          startDay: String(body.startDay ?? weekStart(day)),
          planned,
          name: String(body.name ?? 'Saved week'),
          notes: body.notes ? String(body.notes) : undefined,
        });
        break;

      case 'createWeek':
        createWeekTemplate({
          name: String(body.name ?? 'New week'),
          notes: body.notes ? String(body.notes) : undefined,
          days: (Array.isArray(body.days) ? body.days : []).map((d) => (d ? String(d) : null)),
        });
        break;

      case 'templateItem':
        updateMealTemplateItem(Number(body.itemId), Number(body.quantity) || 0, asUnit(body.unit));
        break;

      case 'deleteMealTemplate':
        deleteMealTemplate(String(body.id));
        break;

      case 'deleteDayTemplate':
        deleteDayTemplate(String(body.id));
        break;

      case 'deleteWeekTemplate':
        deleteWeekTemplate(String(body.id));
        break;

      case 'targets':
        setSetting('targets', JSON.stringify({ ...getTargets(), ...(body.targets as object) }));
        break;

      case 'syncMyFitnessPal': {
        const result = await syncSource('myfitnesspal');
        return NextResponse.json({ ...payload(day, planned), sync: result });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    // These are user-facing validation failures ("that meal is empty", "cannot
    // be expressed in oz"), not server faults — the message is the point.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  return NextResponse.json(payload(day, planned));
}

import { all, one, run, tx } from './db';
import { DOW_NAMES, addDays, type DayKey } from './dates';
import {
  NUTRIENT_KEYS,
  MEAL_SLOTS,
  resolveNutrients,
  pickNutrients,
  sumNutrients,
  type Basis,
  type Nutrients,
  type Unit,
} from './nutrition';

/**
 * The reusable-plan layer: item → meal → day → week.
 *
 * A saved day references saved *meals* rather than copying their items, so
 * fixing a meal fixes every day built on it. Applying a template to a date does
 * the opposite — it materialises independent entries, which can then diverge
 * from the template without editing it. That asymmetry is the point: templates
 * are the recipe, entries are the record.
 */

const NUT_COLS = NUTRIENT_KEYS.map((k) => `n_${k}`);


export interface FoodRow extends Nutrients {
  id: string;
  name: string;
  brand: string | null;
  serving_label: string;
  serving_g: number | null;
  origin: string;
  tags: string | null;
}

export interface EntryRow {
  id: string;
  source_id: string;
  day: DayKey;
  meal: string;
  position: number;
  food_id: string | null;
  food: string;
  brand: string | null;
  quantity: number;
  unit: Unit;
  basis: Basis;
  serving_g: number | null;
  planned: number;
}

/** An entry with its resolved nutrients attached. */
export interface ResolvedEntry extends EntryRow {
  nutrients: Nutrients;
  /** Per-100 g or per-serving snapshot, for the detail panel. */
  base: Nutrients;
  editableUnits: Unit[];
}

export interface MealGroup {
  slot: string;
  entries: ResolvedEntry[];
  totals: Nutrients;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function entrySelect(): string {
  return `SELECT id, source_id, day, meal, position, food_id, food, brand, quantity, unit,
                 basis, serving_g, planned, ${NUT_COLS.join(', ')}
          FROM nutrition_entries`;
}

function resolve(row: Record<string, unknown>): ResolvedEntry {
  const base = pickNutrients(row, 'n_');
  const entry = row as unknown as EntryRow;
  const nutrients = resolveNutrients({
    quantity: entry.quantity,
    unit: entry.unit,
    basis: entry.basis,
    serving_g: entry.serving_g,
    base,
  });
  return {
    ...entry,
    base,
    nutrients,
    editableUnits:
      entry.basis === 'per_serving'
        ? ['serving']
        : entry.serving_g && entry.serving_g > 0
          ? ['g', 'oz', 'serving']
          : ['g', 'oz'],
  };
}

export function entriesForDay(day: DayKey, planned: boolean): ResolvedEntry[] {
  const rows = all<Record<string, unknown>>(
    `${entrySelect()} WHERE day = ? AND planned = ? ORDER BY position, rowid`,
    [day, planned ? 1 : 0],
  );
  return rows.map(resolve);
}

/** Groups a day's entries into meals, each with its own totals. */
export function groupIntoMeals(entries: ResolvedEntry[]): MealGroup[] {
  const bySlot = new Map<string, ResolvedEntry[]>();
  for (const e of entries) bySlot.set(e.meal, [...(bySlot.get(e.meal) ?? []), e]);

  const order = [...MEAL_SLOTS] as string[];
  return [...bySlot.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([slot, list]) => ({
      slot,
      entries: list,
      totals: sumNutrients(list.map((e) => e.nutrients)),
    }));
}

export function getFood(id: string): FoodRow | null {
  return one<FoodRow>('SELECT * FROM foods WHERE id = ?', [id]);
}

export function searchFoodCatalog(query: string, limit = 40): FoodRow[] {
  const q = query.trim();
  if (!q) return all<FoodRow>('SELECT * FROM foods ORDER BY name LIMIT ?', [limit]);
  return all<FoodRow>(
    'SELECT * FROM foods WHERE name LIKE ? OR brand LIKE ? OR tags LIKE ? ORDER BY name LIMIT ?',
    [`%${q}%`, `%${q}%`, `%${q}%`, limit],
  );
}

// ---------------------------------------------------------------------------
// Writing entries
// ---------------------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextPosition(day: DayKey, slot: string, planned: boolean): number {
  const row = one<{ p: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM nutrition_entries WHERE day = ? AND meal = ? AND planned = ?',
    [day, slot, planned ? 1 : 0],
  );
  return row?.p ?? 0;
}

export interface AddEntryArgs {
  day: DayKey;
  slot: string;
  planned: boolean;
  foodId?: string;
  quantity: number;
  unit: Unit;
  /** For free-text entries with no catalog food behind them. */
  custom?: { name: string; brand?: string; nutrients: Nutrients; basis: Basis; servingG?: number | null };
}

export function addEntry(args: AddEntryArgs): string {
  const id = newId('local');
  const position = nextPosition(args.day, args.slot, args.planned);

  let name: string;
  let brand: string | null;
  let base: Nutrients;
  let basis: Basis;
  let servingG: number | null;
  let foodId: string | null = null;

  if (args.foodId) {
    const food = getFood(args.foodId);
    if (!food) throw new Error(`Unknown food: ${args.foodId}`);
    foodId = food.id;
    name = food.name;
    brand = food.brand;
    base = pickNutrients(food as unknown as Record<string, unknown>);
    basis = 'per_100g';
    servingG = food.serving_g;
  } else if (args.custom) {
    name = args.custom.name;
    brand = args.custom.brand ?? null;
    base = args.custom.nutrients;
    basis = args.custom.basis;
    servingG = args.custom.servingG ?? null;
  } else {
    throw new Error('addEntry needs either foodId or custom');
  }

  insertEntry({
    id,
    day: args.day,
    slot: args.slot,
    planned: args.planned,
    position,
    foodId,
    name,
    brand,
    quantity: args.quantity,
    unit: args.unit,
    basis,
    servingG,
    base,
  });

  return id;
}

function insertEntry(e: {
  id: string;
  day: DayKey;
  slot: string;
  planned: boolean;
  position: number;
  foodId: string | null;
  name: string;
  brand: string | null;
  quantity: number;
  unit: Unit;
  basis: Basis;
  servingG: number | null;
  base: Nutrients;
}): void {
  run(
    `INSERT INTO nutrition_entries
       (id, source_id, external_id, day, meal, position, food_id, food, brand,
        quantity, unit, basis, serving_g, ${NUT_COLS.join(', ')}, planned, logged_at)
     VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NUT_COLS.map(() => '?').join(', ')}, ?, ?)`,
    [
      e.id, e.id, e.day, e.slot, e.position, e.foodId, e.name, e.brand,
      e.quantity, e.unit, e.basis, e.servingG,
      ...NUTRIENT_KEYS.map((k) => e.base[k] ?? 0),
      e.planned ? 1 : 0, new Date().toISOString(),
    ],
  );
}

/** Changes an entry's amount. Units are validated against what it can support. */
export function updateEntryAmount(id: string, quantity: number, unit: Unit): void {
  const row = one<Record<string, unknown>>(`${entrySelect()} WHERE id = ?`, [id]);
  if (!row) throw new Error('Unknown entry');
  const entry = resolve(row);

  if (!entry.editableUnits.includes(unit)) {
    throw new Error(
      `This entry cannot be expressed in ${unit} — it came from a source that logged servings without a weight.`,
    );
  }
  run('UPDATE nutrition_entries SET quantity = ?, unit = ? WHERE id = ?', [
    Math.max(0, quantity),
    unit,
    id,
  ]);
}

export function deleteEntry(id: string): void {
  run('DELETE FROM nutrition_entries WHERE id = ?', [id]);
}

/** Clears the app's own entries for a day, leaving imported rows alone. */
export function clearLocalEntries(day: DayKey, planned: boolean, slot?: string): number {
  const before = one<{ n: number }>(
    `SELECT COUNT(*) n FROM nutrition_entries WHERE day = ? AND planned = ? AND source_id = 'local'${slot ? ' AND meal = ?' : ''}`,
    slot ? [day, planned ? 1 : 0, slot] : [day, planned ? 1 : 0],
  );
  run(
    `DELETE FROM nutrition_entries WHERE day = ? AND planned = ? AND source_id = 'local'${slot ? ' AND meal = ?' : ''}`,
    slot ? [day, planned ? 1 : 0, slot] : [day, planned ? 1 : 0],
  );
  return before?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Meal templates
// ---------------------------------------------------------------------------

export interface MealTemplateRow {
  id: string;
  name: string;
  slot: string;
  notes: string | null;
  tags: string | null;
  created_at: string;
  used_count: number;
}

export interface MealTemplateDetail extends MealTemplateRow {
  items: (ResolvedEntry & { template_item_id: number })[];
  totals: Nutrients;
}

export function listMealTemplates(): MealTemplateDetail[] {
  const templates = all<MealTemplateRow>('SELECT * FROM meal_templates ORDER BY slot, name');
  return templates.map((t) => mealTemplateDetail(t));
}

export function getMealTemplate(id: string): MealTemplateDetail | null {
  const t = one<MealTemplateRow>('SELECT * FROM meal_templates WHERE id = ?', [id]);
  return t ? mealTemplateDetail(t) : null;
}

function mealTemplateDetail(t: MealTemplateRow): MealTemplateDetail {
  const rows = all<Record<string, unknown>>(
    `SELECT id AS template_item_id, template_id, position, food_id, food, brand, quantity, unit,
            basis, serving_g, ${NUT_COLS.join(', ')}
     FROM meal_template_items WHERE template_id = ? ORDER BY position, id`,
    [t.id],
  );
  const items = rows.map((r) => ({
    ...resolve({ ...r, id: String(r.template_item_id), day: '', meal: t.slot, source_id: 'template', planned: 0 }),
    template_item_id: Number(r.template_item_id),
  }));
  return { ...t, items, totals: sumNutrients(items.map((i) => i.nutrients)) };
}

export function createMealTemplate(args: {
  name: string;
  slot: string;
  notes?: string;
  tags?: string;
  items: { foodId?: string | null; food: string; brand?: string | null; quantity: number; unit: Unit; basis: Basis; servingG: number | null; base: Nutrients }[];
}): string {
  const id = newId('mt');
  run(
    'INSERT INTO meal_templates (id, name, slot, notes, tags, created_at) VALUES (?,?,?,?,?,?)',
    [id, args.name, args.slot, args.notes ?? null, args.tags ?? null, new Date().toISOString()],
  );
  args.items.forEach((item, i) => {
    run(
      `INSERT INTO meal_template_items
         (template_id, position, food_id, food, brand, quantity, unit, basis, serving_g, ${NUT_COLS.join(', ')})
       VALUES (?,?,?,?,?,?,?,?,?, ${NUT_COLS.map(() => '?').join(', ')})`,
      [
        id, i, item.foodId ?? null, item.food, item.brand ?? null,
        item.quantity, item.unit, item.basis, item.servingG,
        ...NUTRIENT_KEYS.map((k) => item.base[k] ?? 0),
      ],
    );
  });
  return id;
}

/** Snapshots one meal of a logged/planned day into a reusable meal template. */
export function saveMealAsTemplate(day: DayKey, slot: string, planned: boolean, name: string): string {
  const entries = entriesForDay(day, planned).filter((e) => e.meal === slot);
  if (!entries.length) throw new Error('That meal is empty.');
  return createMealTemplate({
    name,
    slot,
    items: entries.map((e) => ({
      foodId: e.food_id,
      food: e.food,
      brand: e.brand,
      quantity: e.quantity,
      unit: e.unit,
      basis: e.basis,
      servingG: e.serving_g,
      base: e.base,
    })),
  });
}

export function deleteMealTemplate(id: string): void {
  run('DELETE FROM meal_templates WHERE id = ?', [id]);
}

export function updateMealTemplateItem(itemId: number, quantity: number, unit: Unit): void {
  run('UPDATE meal_template_items SET quantity = ?, unit = ? WHERE id = ?', [
    Math.max(0, quantity),
    unit,
    itemId,
  ]);
}

/** Materialises a meal template onto a date. Returns how many entries landed. */
export function applyMealTemplate(args: {
  templateId: string;
  day: DayKey;
  slot?: string;
  planned: boolean;
  replace?: boolean;
}): number {
  const t = getMealTemplate(args.templateId);
  if (!t) throw new Error('Unknown meal template');
  const slot = args.slot ?? t.slot;

  return tx(() => {
    if (args.replace) clearLocalEntries(args.day, args.planned, slot);
    let position = nextPosition(args.day, slot, args.planned);

    for (const item of t.items) {
      insertEntry({
        id: newId('local'),
        day: args.day,
        slot,
        planned: args.planned,
        position: position++,
        foodId: item.food_id,
        name: item.food,
        brand: item.brand,
        quantity: item.quantity,
        unit: item.unit,
        basis: item.basis,
        servingG: item.serving_g,
        base: item.base,
      });
    }
    run('UPDATE meal_templates SET used_count = used_count + 1 WHERE id = ?', [args.templateId]);
    return t.items.length;
  });
}

// ---------------------------------------------------------------------------
// Day templates
// ---------------------------------------------------------------------------

export interface DayTemplateRow {
  id: string;
  name: string;
  notes: string | null;
  tags: string | null;
  created_at: string;
  used_count: number;
}

export interface DayTemplateDetail extends DayTemplateRow {
  meals: { slot: string; template: MealTemplateDetail }[];
  totals: Nutrients;
}

export function listDayTemplates(): DayTemplateDetail[] {
  return all<DayTemplateRow>('SELECT * FROM day_templates ORDER BY name').map(dayTemplateDetail);
}

export function getDayTemplate(id: string): DayTemplateDetail | null {
  const t = one<DayTemplateRow>('SELECT * FROM day_templates WHERE id = ?', [id]);
  return t ? dayTemplateDetail(t) : null;
}

function dayTemplateDetail(t: DayTemplateRow): DayTemplateDetail {
  const links = all<{ slot: string; meal_template_id: string }>(
    'SELECT slot, meal_template_id FROM day_template_meals WHERE day_template_id = ? ORDER BY position, id',
    [t.id],
  );
  const meals = links
    .map((l) => {
      const template = getMealTemplate(l.meal_template_id);
      return template ? { slot: l.slot, template } : null;
    })
    .filter((m): m is { slot: string; template: MealTemplateDetail } => m !== null);

  return { ...t, meals, totals: sumNutrients(meals.map((m) => m.template.totals)) };
}

export function createDayTemplate(args: {
  name: string;
  notes?: string;
  tags?: string;
  meals: { slot: string; mealTemplateId: string }[];
}): string {
  const id = newId('dt');
  run('INSERT INTO day_templates (id, name, notes, tags, created_at) VALUES (?,?,?,?,?)', [
    id, args.name, args.notes ?? null, args.tags ?? null, new Date().toISOString(),
  ]);
  args.meals.forEach((m, i) => {
    run(
      'INSERT INTO day_template_meals (day_template_id, meal_template_id, slot, position) VALUES (?,?,?,?)',
      [id, m.mealTemplateId, m.slot, i],
    );
  });
  return id;
}

/**
 * Saves a whole day as a template, creating a reusable meal template per slot
 * along the way — so the day, its meals and their items all become reusable in
 * one action rather than three.
 */
export function saveDayAsTemplate(args: {
  day: DayKey;
  planned: boolean;
  name: string;
  notes?: string;
}): string {
  const groups = groupIntoMeals(entriesForDay(args.day, args.planned));
  if (!groups.length) throw new Error('There is nothing logged on that day to save.');

  return tx(() => {
    const meals = groups.map((g) => ({
      slot: g.slot,
      mealTemplateId: createMealTemplate({
        name: `${args.name} · ${g.slot}`,
        slot: g.slot,
        items: g.entries.map((e) => ({
          foodId: e.food_id,
          food: e.food,
          brand: e.brand,
          quantity: e.quantity,
          unit: e.unit,
          basis: e.basis,
          servingG: e.serving_g,
          base: e.base,
        })),
      }),
    }));
    return createDayTemplate({ name: args.name, notes: args.notes, meals });
  });
}

export function deleteDayTemplate(id: string): void {
  run('DELETE FROM day_templates WHERE id = ?', [id]);
}

export function applyDayTemplate(args: {
  templateId: string;
  day: DayKey;
  planned: boolean;
  replace?: boolean;
}): number {
  const t = getDayTemplate(args.templateId);
  if (!t) throw new Error('Unknown day template');

  return tx(() => {
    if (args.replace) clearLocalEntries(args.day, args.planned);
    let count = 0;
    for (const m of t.meals) {
      count += applyMealTemplate({
        templateId: m.template.id,
        day: args.day,
        slot: m.slot,
        planned: args.planned,
      });
    }
    run('UPDATE day_templates SET used_count = used_count + 1 WHERE id = ?', [args.templateId]);
    return count;
  });
}

// ---------------------------------------------------------------------------
// Week templates
// ---------------------------------------------------------------------------

export interface WeekTemplateRow {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  used_count: number;
}

export interface WeekTemplateDetail extends WeekTemplateRow {
  /** Index 0 = Monday. */
  days: (DayTemplateDetail | null)[];
  avgDailyTotals: Nutrients;
}

export function listWeekTemplates(): WeekTemplateDetail[] {
  return all<WeekTemplateRow>('SELECT * FROM week_templates ORDER BY name').map(weekTemplateDetail);
}

export function getWeekTemplate(id: string): WeekTemplateDetail | null {
  const t = one<WeekTemplateRow>('SELECT * FROM week_templates WHERE id = ?', [id]);
  return t ? weekTemplateDetail(t) : null;
}

function weekTemplateDetail(t: WeekTemplateRow): WeekTemplateDetail {
  const links = all<{ dow: number; day_template_id: string | null }>(
    'SELECT dow, day_template_id FROM week_template_days WHERE week_template_id = ? ORDER BY dow',
    [t.id],
  );
  const days: (DayTemplateDetail | null)[] = Array.from({ length: 7 }, () => null);
  for (const l of links) {
    if (l.day_template_id && l.dow >= 0 && l.dow < 7) {
      days[l.dow] = getDayTemplate(l.day_template_id);
    }
  }
  const filled = days.filter((d): d is DayTemplateDetail => d !== null);
  const summed = sumNutrients(filled.map((d) => d.totals));
  const avg = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) avg[k] = filled.length ? Math.round((summed[k] / filled.length) * 100) / 100 : 0;

  return { ...t, days, avgDailyTotals: avg };
}

export function createWeekTemplate(args: {
  name: string;
  notes?: string;
  days: (string | null)[];
}): string {
  const id = newId('wt');
  run('INSERT INTO week_templates (id, name, notes, created_at) VALUES (?,?,?,?)', [
    id, args.name, args.notes ?? null, new Date().toISOString(),
  ]);
  args.days.slice(0, 7).forEach((dayTemplateId, dow) => {
    if (!dayTemplateId) return;
    run(
      'INSERT INTO week_template_days (week_template_id, dow, day_template_id) VALUES (?,?,?) ON CONFLICT(week_template_id, dow) DO UPDATE SET day_template_id = excluded.day_template_id',
      [id, dow, dayTemplateId],
    );
  });
  return id;
}

export function deleteWeekTemplate(id: string): void {
  run('DELETE FROM week_templates WHERE id = ?', [id]);
}

/** Rolls a week template out from `startDay` (treated as the Monday). */
export function applyWeekTemplate(args: {
  templateId: string;
  startDay: DayKey;
  planned: boolean;
  replace?: boolean;
}): { days: number; entries: number } {
  const t = getWeekTemplate(args.templateId);
  if (!t) throw new Error('Unknown week template');

  return tx(() => {
    let days = 0;
    let entries = 0;
    t.days.forEach((dayTemplate, dow) => {
      if (!dayTemplate) return;
      const day = addDays(args.startDay, dow);
      entries += applyDayTemplate({
        templateId: dayTemplate.id,
        day,
        planned: args.planned,
        replace: args.replace,
      });
      days += 1;
    });
    run('UPDATE week_templates SET used_count = used_count + 1 WHERE id = ?', [args.templateId]);
    return { days, entries };
  });
}

/** Saves seven consecutive days as a week template, one day template each. */
export function saveWeekAsTemplate(args: {
  startDay: DayKey;
  planned: boolean;
  name: string;
  notes?: string;
}): string {
  return tx(() => {
    const dayIds: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(args.startDay, i);
      const groups = groupIntoMeals(entriesForDay(day, args.planned));
      if (!groups.length) {
        dayIds.push(null);
        continue;
      }
      dayIds.push(
        saveDayAsTemplate({
          day,
          planned: args.planned,
          name: `${args.name} · ${DOW_NAMES[i]}`,
        }),
      );
    }
    if (dayIds.every((d) => d === null)) throw new Error('That week has nothing logged to save.');
    return createWeekTemplate({ name: args.name, notes: args.notes, days: dayIds });
  });
}

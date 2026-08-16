/**
 * Starter meal / day / week templates.
 *
 * These exist so the reusable-plan machinery is demonstrable on a fresh
 * install rather than starting from an empty library. Everything here is
 * editable and deletable through the UI; the shapes are the same ones the
 * "save this day as a template" button produces.
 */

export interface MealTemplateSeed {
  id: string;
  name: string;
  slot: string;
  tags?: string;
  notes?: string;
  /** Quantities are grams, since every catalog food carries a weight. */
  items: { foodId: string; grams: number }[];
}

export const MEAL_TEMPLATES: MealTemplateSeed[] = [
  {
    id: 'mt_oats_whey',
    name: 'Oats, berries & whey',
    slot: 'breakfast',
    tags: 'high-carb,pre-training',
    items: [
      { foodId: 'f_oats', grams: 80 },
      { foodId: 'f_berries', grams: 150 },
      { foodId: 'f_whey', grams: 30 },
      { foodId: 'f_honey', grams: 21 },
    ],
  },
  {
    id: 'mt_omelette',
    name: 'Three-egg omelette & sourdough',
    slot: 'breakfast',
    tags: 'moderate-carb',
    items: [
      { foodId: 'f_eggs', grams: 150 },
      { foodId: 'f_spinach', grams: 60 },
      { foodId: 'f_sourdough', grams: 90 },
      { foodId: 'f_olive_oil', grams: 7 },
    ],
  },
  {
    id: 'mt_yogurt_bowl',
    name: 'Greek yogurt bowl',
    slot: 'breakfast',
    tags: 'low-carb,rest-day',
    items: [
      { foodId: 'f_greek_yogurt', grams: 200 },
      { foodId: 'f_berries', grams: 100 },
      { foodId: 'f_almonds', grams: 30 },
    ],
  },
  {
    id: 'mt_chicken_rice',
    name: 'Chicken & rice bowl',
    slot: 'lunch',
    tags: 'high-protein,staple',
    items: [
      { foodId: 'f_chicken_breast', grams: 180 },
      { foodId: 'f_white_rice', grams: 250 },
      { foodId: 'f_broccoli', grams: 150 },
      { foodId: 'f_olive_oil', grams: 10 },
    ],
  },
  {
    id: 'mt_poke',
    name: 'Salmon poke bowl',
    slot: 'lunch',
    tags: 'omega3',
    items: [
      { foodId: 'f_salmon', grams: 150 },
      { foodId: 'f_white_rice', grams: 200 },
      { foodId: 'f_avocado', grams: 60 },
      { foodId: 'f_mixed_salad', grams: 80 },
    ],
  },
  {
    id: 'mt_steak_potatoes',
    name: 'Steak, potatoes & greens',
    slot: 'dinner',
    tags: 'iron,staple',
    items: [
      { foodId: 'f_sirloin', grams: 200 },
      { foodId: 'f_potato', grams: 300 },
      { foodId: 'f_spinach', grams: 100 },
      { foodId: 'f_olive_oil', grams: 10 },
    ],
  },
  {
    id: 'mt_cod_quinoa',
    name: 'Cod, quinoa & broccoli',
    slot: 'dinner',
    tags: 'lean,rest-day',
    items: [
      { foodId: 'f_cod', grams: 180 },
      { foodId: 'f_quinoa', grams: 185 },
      { foodId: 'f_broccoli', grams: 200 },
      { foodId: 'f_olive_oil', grams: 7 },
    ],
  },
  {
    id: 'mt_chilli',
    name: 'Beef chilli & rice',
    slot: 'dinner',
    tags: 'high-carb,fiber',
    items: [
      { foodId: 'f_ground_beef', grams: 180 },
      { foodId: 'f_black_beans', grams: 150 },
      { foodId: 'f_brown_rice', grams: 200 },
    ],
  },
  {
    id: 'mt_shake_banana',
    name: 'Whey shake & banana',
    slot: 'snack',
    tags: 'post-training',
    items: [
      { foodId: 'f_whey', grams: 30 },
      { foodId: 'f_banana', grams: 118 },
    ],
  },
  {
    id: 'mt_cottage_almonds',
    name: 'Cottage cheese & almonds',
    slot: 'snack',
    tags: 'casein,evening',
    items: [
      { foodId: 'f_cottage_cheese', grams: 150 },
      { foodId: 'f_almonds', grams: 30 },
    ],
  },
  {
    id: 'mt_intra',
    name: 'Intra-workout drink',
    slot: 'intra',
    tags: 'long-session',
    items: [{ foodId: 'f_sports_drink', grams: 500 }],
  },
];

export interface DayTemplateSeed {
  id: string;
  name: string;
  notes?: string;
  tags?: string;
  meals: { slot: string; mealTemplateId: string }[];
}

export const DAY_TEMPLATES: DayTemplateSeed[] = [
  {
    id: 'dt_hard',
    name: 'Hard training day',
    notes: 'Interval or threshold session. Carbs up, protein high.',
    tags: 'training',
    meals: [
      { slot: 'breakfast', mealTemplateId: 'mt_oats_whey' },
      { slot: 'lunch', mealTemplateId: 'mt_chicken_rice' },
      { slot: 'dinner', mealTemplateId: 'mt_steak_potatoes' },
      { slot: 'snack', mealTemplateId: 'mt_shake_banana' },
      { slot: 'intra', mealTemplateId: 'mt_intra' },
    ],
  },
  {
    id: 'dt_easy',
    name: 'Easy / rest day',
    notes: 'Lower carbohydrate, same protein.',
    tags: 'rest',
    meals: [
      { slot: 'breakfast', mealTemplateId: 'mt_yogurt_bowl' },
      { slot: 'lunch', mealTemplateId: 'mt_poke' },
      { slot: 'dinner', mealTemplateId: 'mt_cod_quinoa' },
      { slot: 'snack', mealTemplateId: 'mt_cottage_almonds' },
    ],
  },
  {
    id: 'dt_long',
    name: 'Long session day',
    notes: 'Big aerobic volume — extra carbohydrate through the day.',
    tags: 'training,endurance',
    meals: [
      { slot: 'breakfast', mealTemplateId: 'mt_omelette' },
      { slot: 'lunch', mealTemplateId: 'mt_chicken_rice' },
      { slot: 'dinner', mealTemplateId: 'mt_chilli' },
      { slot: 'snack', mealTemplateId: 'mt_shake_banana' },
      { slot: 'intra', mealTemplateId: 'mt_intra' },
    ],
  },
];

export interface WeekTemplateSeed {
  id: string;
  name: string;
  notes?: string;
  /** Index 0 = Monday. */
  days: (string | null)[];
}

export const WEEK_TEMPLATES: WeekTemplateSeed[] = [
  {
    id: 'wt_standard',
    name: 'Standard training week',
    notes: 'Matches the 3-week build microcycle: hard Mon/Tue/Wed/Fri, long Saturday, easy Thu/Sun.',
    days: ['dt_hard', 'dt_hard', 'dt_hard', 'dt_easy', 'dt_hard', 'dt_long', 'dt_easy'],
  },
  {
    id: 'wt_deload',
    name: 'Deload week',
    notes: 'Volume trimmed — fewer high-carb days.',
    days: ['dt_easy', 'dt_hard', 'dt_easy', 'dt_easy', 'dt_hard', 'dt_easy', 'dt_easy'],
  },
];

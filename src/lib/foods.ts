import type { Nutrients } from './nutrition';

/**
 * Food catalog, **per 100 g**, with the micronutrients the detail panel shows.
 *
 * Values are conventional reference figures for the cooked/prepared form named,
 * rounded to the precision a food label would carry. They are good enough to
 * plan and track against; they are not a substitute for a lab assay of the
 * actual item on your plate.
 */

export interface FoodSeed extends Partial<Nutrients> {
  id: string;
  name: string;
  brand?: string;
  /** How one serving is described in the UI. */
  serving: string;
  /** Grams in one serving — required, since it is what makes units convert. */
  servingG: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  tags: string;
}

export const FOODS: FoodSeed[] = [
  // --- Protein ------------------------------------------------------------
  { id: 'f_chicken_breast', name: 'Chicken breast, grilled', serving: '1 breast', servingG: 150, kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, sat_fat_g: 1, sodium_mg: 74, potassium_mg: 256, calcium_mg: 15, iron_mg: 1, magnesium_mg: 29, zinc_mg: 1, vit_b12_mcg: 0.3, folate_mcg: 4, cholesterol_mg: 85, tags: 'protein,lean' },
  { id: 'f_salmon', name: 'Salmon fillet, baked', serving: '1 fillet', servingG: 150, kcal: 208, protein_g: 23, carbs_g: 0, fat_g: 12.4, sat_fat_g: 3.1, sodium_mg: 59, potassium_mg: 363, calcium_mg: 9, iron_mg: 0.3, magnesium_mg: 27, zinc_mg: 0.4, vit_d_mcg: 11, vit_b12_mcg: 3.2, folate_mcg: 25, cholesterol_mg: 55, omega3_g: 2.3, tags: 'protein,omega3' },
  { id: 'f_cod', name: 'Cod fillet, baked', serving: '1 fillet', servingG: 150, kcal: 105, protein_g: 23, carbs_g: 0, fat_g: 0.9, sat_fat_g: 0.2, sodium_mg: 70, potassium_mg: 413, calcium_mg: 14, iron_mg: 0.4, magnesium_mg: 32, zinc_mg: 0.5, vit_d_mcg: 1.2, vit_b12_mcg: 1.1, folate_mcg: 8, cholesterol_mg: 55, omega3_g: 0.2, tags: 'protein,lean' },
  { id: 'f_sirloin', name: 'Sirloin steak, lean', serving: '1 steak', servingG: 150, kcal: 195, protein_g: 28, carbs_g: 0, fat_g: 9, sat_fat_g: 3.5, sodium_mg: 55, potassium_mg: 340, calcium_mg: 18, iron_mg: 2.6, magnesium_mg: 25, zinc_mg: 4.8, vit_b12_mcg: 2.5, folate_mcg: 8, cholesterol_mg: 75, tags: 'protein,iron' },
  { id: 'f_ground_beef', name: 'Ground beef 90/10', serving: '150 g', servingG: 150, kcal: 178, protein_g: 26, carbs_g: 0, fat_g: 7.7, sat_fat_g: 3.1, sodium_mg: 64, potassium_mg: 318, calcium_mg: 17, iron_mg: 2.5, magnesium_mg: 22, zinc_mg: 5.9, vit_b12_mcg: 2.6, folate_mcg: 7, cholesterol_mg: 78, tags: 'protein,iron' },
  { id: 'f_eggs', name: 'Whole eggs', serving: '1 large egg', servingG: 50, kcal: 156, protein_g: 12.6, carbs_g: 0.8, fat_g: 10.6, sat_fat_g: 3.3, sodium_mg: 142, potassium_mg: 138, calcium_mg: 56, iron_mg: 1.8, magnesium_mg: 12, zinc_mg: 1.1, vit_a_mcg: 149, vit_d_mcg: 2, vit_b12_mcg: 1.1, folate_mcg: 44, cholesterol_mg: 373, omega3_g: 0.1, tags: 'protein,breakfast' },
  { id: 'f_egg_whites', name: 'Egg whites', serving: '100 g', servingG: 100, kcal: 52, protein_g: 10.8, carbs_g: 0.7, fat_g: 0.2, sodium_mg: 166, potassium_mg: 163, calcium_mg: 7, magnesium_mg: 11, zinc_mg: 0.1, vit_b12_mcg: 0.1, folate_mcg: 4, tags: 'protein,lean' },
  { id: 'f_greek_yogurt', name: 'Greek yogurt 2%', serving: '1 pot', servingG: 200, kcal: 73, protein_g: 10, carbs_g: 3.8, fat_g: 2, sat_fat_g: 1.3, sugar_g: 3.6, sodium_mg: 34, potassium_mg: 141, calcium_mg: 111, iron_mg: 0.1, magnesium_mg: 11, zinc_mg: 0.6, vit_a_mcg: 18, vit_b12_mcg: 0.8, folate_mcg: 7, cholesterol_mg: 8, tags: 'protein,breakfast,dairy' },
  { id: 'f_cottage_cheese', name: 'Cottage cheese 4%', serving: '150 g', servingG: 150, kcal: 98, protein_g: 11.3, carbs_g: 3.4, fat_g: 4.3, sat_fat_g: 1.7, sugar_g: 2.7, sodium_mg: 310, potassium_mg: 104, calcium_mg: 83, iron_mg: 0.1, magnesium_mg: 8, zinc_mg: 0.4, vit_a_mcg: 37, vit_b12_mcg: 0.4, folate_mcg: 12, cholesterol_mg: 17, tags: 'protein,casein,dairy' },
  { id: 'f_whey', name: 'Whey isolate', brand: 'Generic', serving: '1 scoop', servingG: 30, kcal: 375, protein_g: 83, carbs_g: 5, fat_g: 2, sat_fat_g: 1, sugar_g: 2, sodium_mg: 183, potassium_mg: 500, calcium_mg: 500, iron_mg: 0.5, magnesium_mg: 60, zinc_mg: 1, vit_b12_mcg: 1.5, cholesterol_mg: 20, tags: 'protein,supplement' },
  { id: 'f_tofu', name: 'Firm tofu', serving: '150 g', servingG: 150, kcal: 115, protein_g: 13, carbs_g: 2.8, fat_g: 6.9, sat_fat_g: 1, fiber_g: 1.8, sodium_mg: 12, potassium_mg: 148, calcium_mg: 350, iron_mg: 2.7, magnesium_mg: 60, zinc_mg: 1.6, folate_mcg: 19, omega3_g: 0.4, tags: 'protein,plant' },
  { id: 'f_lentils', name: 'Lentils, cooked', serving: '1 cup', servingG: 200, kcal: 116, protein_g: 9, carbs_g: 20, fat_g: 0.4, fiber_g: 7.9, sugar_g: 1.8, sodium_mg: 2, potassium_mg: 369, calcium_mg: 19, iron_mg: 3.3, magnesium_mg: 36, zinc_mg: 1.3, vit_c_mg: 1.5, folate_mcg: 181, tags: 'protein,carb,fiber' },
  { id: 'f_black_beans', name: 'Black beans, cooked', serving: '1 cup', servingG: 175, kcal: 132, protein_g: 8.9, carbs_g: 23.7, fat_g: 0.5, fiber_g: 8.7, sugar_g: 0.3, sodium_mg: 1, potassium_mg: 355, calcium_mg: 27, iron_mg: 2.1, magnesium_mg: 70, zinc_mg: 1.1, folate_mcg: 149, tags: 'protein,carb,fiber' },
  { id: 'f_protein_bar', name: 'Protein bar', brand: 'Generic', serving: '1 bar', servingG: 60, kcal: 357, protein_g: 33.3, carbs_g: 36.7, fat_g: 11.7, sat_fat_g: 4, fiber_g: 10, sugar_g: 5, sodium_mg: 300, potassium_mg: 320, calcium_mg: 300, iron_mg: 3.6, magnesium_mg: 90, zinc_mg: 2.5, tags: 'protein,snack' },

  // --- Carbohydrate -------------------------------------------------------
  { id: 'f_oats', name: 'Rolled oats, dry', serving: '80 g', servingG: 80, kcal: 379, protein_g: 13.2, carbs_g: 67.7, fat_g: 6.5, sat_fat_g: 1.1, fiber_g: 10.1, sugar_g: 1, sodium_mg: 6, potassium_mg: 362, calcium_mg: 52, iron_mg: 4.3, magnesium_mg: 138, zinc_mg: 3.6, folate_mcg: 32, tags: 'carb,breakfast,fiber' },
  { id: 'f_white_rice', name: 'White rice, cooked', serving: '1 cup', servingG: 200, kcal: 130, protein_g: 2.7, carbs_g: 28.2, fat_g: 0.3, fiber_g: 0.4, sodium_mg: 1, potassium_mg: 35, calcium_mg: 10, iron_mg: 1.2, magnesium_mg: 12, zinc_mg: 0.5, folate_mcg: 58, tags: 'carb' },
  { id: 'f_brown_rice', name: 'Brown rice, cooked', serving: '1 cup', servingG: 200, kcal: 123, protein_g: 2.6, carbs_g: 25.6, fat_g: 0.9, fiber_g: 1.6, sodium_mg: 4, potassium_mg: 86, calcium_mg: 3, iron_mg: 0.6, magnesium_mg: 39, zinc_mg: 0.7, folate_mcg: 4, tags: 'carb,fiber' },
  { id: 'f_quinoa', name: 'Quinoa, cooked', serving: '1 cup', servingG: 185, kcal: 120, protein_g: 4.4, carbs_g: 21.3, fat_g: 1.9, fiber_g: 2.8, sugar_g: 0.9, sodium_mg: 7, potassium_mg: 172, calcium_mg: 17, iron_mg: 1.5, magnesium_mg: 64, zinc_mg: 1.1, folate_mcg: 42, tags: 'carb,fiber' },
  { id: 'f_sweet_potato', name: 'Sweet potato, roasted', serving: '1 medium', servingG: 200, kcal: 90, protein_g: 2, carbs_g: 20.7, fat_g: 0.1, fiber_g: 3.3, sugar_g: 6.5, sodium_mg: 36, potassium_mg: 475, calcium_mg: 38, iron_mg: 0.7, magnesium_mg: 27, zinc_mg: 0.3, vit_a_mcg: 961, vit_c_mg: 19.6, folate_mcg: 6, tags: 'carb,fiber' },
  { id: 'f_potato', name: 'Potatoes, boiled', serving: '250 g', servingG: 250, kcal: 87, protein_g: 2, carbs_g: 19.8, fat_g: 0.1, fiber_g: 2, sugar_g: 0.9, sodium_mg: 4, potassium_mg: 379, calcium_mg: 8, iron_mg: 0.3, magnesium_mg: 22, zinc_mg: 0.3, vit_c_mg: 13, folate_mcg: 10, tags: 'carb' },
  { id: 'f_pasta', name: 'Wholewheat pasta, cooked', serving: '1 bowl', servingG: 180, kcal: 124, protein_g: 5.2, carbs_g: 24, fat_g: 0.9, fiber_g: 3.5, sugar_g: 0.8, sodium_mg: 4, potassium_mg: 62, calcium_mg: 15, iron_mg: 1.1, magnesium_mg: 43, zinc_mg: 1.1, folate_mcg: 5, tags: 'carb,fiber' },
  { id: 'f_sourdough', name: 'Sourdough bread', serving: '2 slices', servingG: 90, kcal: 260, protein_g: 9.4, carbs_g: 50, fat_g: 1.9, sat_fat_g: 0.4, fiber_g: 2.7, sugar_g: 2.2, sodium_mg: 520, potassium_mg: 120, calcium_mg: 38, iron_mg: 2.9, magnesium_mg: 26, zinc_mg: 0.9, folate_mcg: 76, tags: 'carb' },
  { id: 'f_honey', name: 'Honey', serving: '1 tbsp', servingG: 21, kcal: 304, protein_g: 0.3, carbs_g: 82.4, fat_g: 0, sugar_g: 82.1, sodium_mg: 4, potassium_mg: 52, calcium_mg: 6, iron_mg: 0.4, magnesium_mg: 2, vit_c_mg: 0.5, tags: 'carb' },

  // --- Fruit & veg --------------------------------------------------------
  { id: 'f_banana', name: 'Banana', serving: '1 medium', servingG: 118, kcal: 89, protein_g: 1.1, carbs_g: 22.8, fat_g: 0.3, fiber_g: 2.6, sugar_g: 12.2, sodium_mg: 1, potassium_mg: 358, calcium_mg: 5, iron_mg: 0.3, magnesium_mg: 27, zinc_mg: 0.2, vit_a_mcg: 3, vit_c_mg: 8.7, folate_mcg: 20, tags: 'fruit,carb' },
  { id: 'f_berries', name: 'Mixed berries', serving: '1 cup', servingG: 150, kcal: 56, protein_g: 0.8, carbs_g: 13, fat_g: 0.4, fiber_g: 3.6, sugar_g: 8, sodium_mg: 1, potassium_mg: 100, calcium_mg: 20, iron_mg: 0.5, magnesium_mg: 15, zinc_mg: 0.2, vit_a_mcg: 5, vit_c_mg: 30, folate_mcg: 22, tags: 'fruit,fiber' },
  { id: 'f_apple', name: 'Apple', serving: '1 medium', servingG: 182, kcal: 52, protein_g: 0.3, carbs_g: 13.8, fat_g: 0.2, fiber_g: 2.4, sugar_g: 10.4, sodium_mg: 1, potassium_mg: 107, calcium_mg: 6, iron_mg: 0.1, magnesium_mg: 5, vit_c_mg: 4.6, folate_mcg: 3, tags: 'fruit,fiber' },
  { id: 'f_broccoli', name: 'Broccoli, steamed', serving: '200 g', servingG: 200, kcal: 35, protein_g: 2.8, carbs_g: 6.8, fat_g: 0.4, fiber_g: 2.6, sugar_g: 1.4, sodium_mg: 41, potassium_mg: 293, calcium_mg: 40, iron_mg: 0.7, magnesium_mg: 21, zinc_mg: 0.5, vit_a_mcg: 77, vit_c_mg: 65, folate_mcg: 108, tags: 'veg,fiber' },
  { id: 'f_spinach', name: 'Spinach, raw', serving: '100 g', servingG: 100, kcal: 23, protein_g: 2.9, carbs_g: 3.6, fat_g: 0.4, fiber_g: 2.2, sugar_g: 0.4, sodium_mg: 79, potassium_mg: 558, calcium_mg: 99, iron_mg: 2.7, magnesium_mg: 79, zinc_mg: 0.5, vit_a_mcg: 469, vit_c_mg: 28, folate_mcg: 194, tags: 'veg,fiber,iron' },
  { id: 'f_mixed_salad', name: 'Mixed leaf salad', serving: '150 g', servingG: 150, kcal: 18, protein_g: 1.4, carbs_g: 3, fat_g: 0.3, fiber_g: 1.8, sugar_g: 1.2, sodium_mg: 20, potassium_mg: 250, calcium_mg: 40, iron_mg: 0.9, magnesium_mg: 14, zinc_mg: 0.2, vit_a_mcg: 300, vit_c_mg: 12, folate_mcg: 90, tags: 'veg,fiber' },
  { id: 'f_beetroot', name: 'Beetroot, cooked', serving: '150 g', servingG: 150, kcal: 44, protein_g: 1.6, carbs_g: 9.8, fat_g: 0.2, fiber_g: 2, sugar_g: 7, sodium_mg: 77, potassium_mg: 305, calcium_mg: 16, iron_mg: 0.8, magnesium_mg: 23, zinc_mg: 0.4, vit_c_mg: 3.6, folate_mcg: 80, tags: 'veg,nitrate' },
  { id: 'f_sauerkraut', name: 'Sauerkraut', serving: '75 g', servingG: 75, kcal: 19, protein_g: 0.9, carbs_g: 4.3, fat_g: 0.1, fiber_g: 2.9, sugar_g: 1.8, sodium_mg: 661, potassium_mg: 170, calcium_mg: 30, iron_mg: 1.5, magnesium_mg: 13, zinc_mg: 0.2, vit_c_mg: 15, folate_mcg: 24, tags: 'veg,gut' },
  { id: 'f_avocado', name: 'Avocado', serving: '1/2 medium', servingG: 100, kcal: 160, protein_g: 2, carbs_g: 8.5, fat_g: 14.7, sat_fat_g: 2.1, fiber_g: 6.7, sugar_g: 0.7, sodium_mg: 7, potassium_mg: 485, calcium_mg: 12, iron_mg: 0.6, magnesium_mg: 29, zinc_mg: 0.6, vit_a_mcg: 7, vit_c_mg: 10, folate_mcg: 81, omega3_g: 0.1, tags: 'fat,fiber' },

  // --- Fats ---------------------------------------------------------------
  { id: 'f_olive_oil', name: 'Olive oil', serving: '1 tbsp', servingG: 14, kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100, sat_fat_g: 13.8, sodium_mg: 2, calcium_mg: 1, iron_mg: 0.6, omega3_g: 0.8, tags: 'fat' },
  { id: 'f_almonds', name: 'Almonds', serving: '30 g', servingG: 30, kcal: 579, protein_g: 21.2, carbs_g: 21.6, fat_g: 49.9, sat_fat_g: 3.8, fiber_g: 12.5, sugar_g: 4.4, sodium_mg: 1, potassium_mg: 733, calcium_mg: 269, iron_mg: 3.7, magnesium_mg: 270, zinc_mg: 3.1, vit_c_mg: 0, folate_mcg: 44, tags: 'fat,fiber,snack' },
  { id: 'f_walnuts', name: 'Walnuts', serving: '30 g', servingG: 30, kcal: 654, protein_g: 15.2, carbs_g: 13.7, fat_g: 65.2, sat_fat_g: 6.1, fiber_g: 6.7, sugar_g: 2.6, sodium_mg: 2, potassium_mg: 441, calcium_mg: 98, iron_mg: 2.9, magnesium_mg: 158, zinc_mg: 3.1, folate_mcg: 98, omega3_g: 9, tags: 'fat,omega3' },
  { id: 'f_peanut_butter', name: 'Peanut butter', serving: '2 tbsp', servingG: 32, kcal: 594, protein_g: 25, carbs_g: 20, fat_g: 50, sat_fat_g: 10, fiber_g: 6, sugar_g: 9, sodium_mg: 425, potassium_mg: 649, calcium_mg: 43, iron_mg: 1.9, magnesium_mg: 168, zinc_mg: 2.9, folate_mcg: 87, tags: 'fat,snack' },
  { id: 'f_dark_choc', name: 'Dark chocolate 85%', serving: '25 g', servingG: 25, kcal: 580, protein_g: 10, carbs_g: 32, fat_g: 48, sat_fat_g: 28, fiber_g: 12, sugar_g: 14, sodium_mg: 20, potassium_mg: 715, calcium_mg: 73, iron_mg: 11.9, magnesium_mg: 228, zinc_mg: 3.3, tags: 'snack,fat' },

  // --- Drinks & recovery --------------------------------------------------
  { id: 'f_kefir', name: 'Kefir, plain', serving: '250 ml', servingG: 250, kcal: 64, protein_g: 3.6, carbs_g: 4.8, fat_g: 3.2, sat_fat_g: 2, sugar_g: 4.8, sodium_mg: 50, potassium_mg: 164, calcium_mg: 120, iron_mg: 0.1, magnesium_mg: 12, zinc_mg: 0.4, vit_a_mcg: 30, vit_d_mcg: 1.2, vit_b12_mcg: 0.3, folate_mcg: 5, cholesterol_mg: 10, tags: 'protein,gut,dairy' },
  { id: 'f_choc_milk', name: 'Chocolate milk', serving: '400 ml', servingG: 400, kcal: 65, protein_g: 3.4, carbs_g: 10.4, fat_g: 1, sat_fat_g: 0.6, sugar_g: 9.8, sodium_mg: 50, potassium_mg: 167, calcium_mg: 112, iron_mg: 0.2, magnesium_mg: 21, zinc_mg: 0.4, vit_a_mcg: 30, vit_d_mcg: 1.1, vit_b12_mcg: 0.4, folate_mcg: 5, cholesterol_mg: 4, tags: 'carb,protein,recovery' },
  { id: 'f_sports_drink', name: 'Electrolyte drink', serving: '500 ml', servingG: 500, kcal: 18, protein_g: 0, carbs_g: 4.4, fat_g: 0, sugar_g: 4.4, sodium_mg: 76, potassium_mg: 30, calcium_mg: 2, magnesium_mg: 4, tags: 'carb,intra' },
];

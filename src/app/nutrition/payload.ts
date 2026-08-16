import type {
  DayTemplateDetail,
  MealGroup,
  MealTemplateDetail,
  ResolvedEntry,
  WeekTemplateDetail,
} from '@/lib/mealPlans';
import type { Nutrients } from '@/lib/nutrition';
import type { SyncResult } from '@/lib/sync/engine';
import type { MacroTargets } from '@/lib/types';

/**
 * The nutrition tab's wire format.
 *
 * Shared by the server page, the API route and the client so a shape change
 * breaks the build rather than the page. Every mutation returns the whole
 * thing — see the route for why.
 */
export interface NutritionPayload {
  day: string;
  weekStart: string;
  planned: boolean;
  entries: ResolvedEntry[];
  meals: MealGroup[];
  totals: Nutrients;
  targets: MacroTargets;
  week: { day: string; totals: Nutrients; count: number }[];
  library: {
    meals: MealTemplateDetail[];
    days: DayTemplateDetail[];
    weeks: WeekTemplateDetail[];
  };
  /** Present only on the response to a MyFitnessPal pull. */
  sync?: SyncResult;
}

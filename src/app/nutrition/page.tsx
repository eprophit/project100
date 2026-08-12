import { NutritionClient } from './NutritionClient';
import { ChartLegend, OverlayChart } from '@/components/charts';
import { SERIES_COLORS } from '@/lib/palette';
import { Card, StatTile } from '@/components/ui';
import { ensureReady } from '@/lib/bootstrap';
import { addDays, today } from '@/lib/dates';
import { getSeries } from '@/lib/metrics';
import { nutritionAdherence, nutritionDay, searchFoods } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function NutritionPage() {
  await ensureReady();

  const day = today();
  const from = addDays(day, -29);
  const initial = nutritionDay(day);
  const foods = searchFoods('', 200);
  const adherence = nutritionAdherence(from, day);

  const kcal = getSeries('nutrition.kcal', from, day);
  const protein = getSeries('nutrition.protein', from, day);
  const carbs = getSeries('nutrition.carbs', from, day);
  const fat = getSeries('nutrition.fat', from, day);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Nutrition</h1>
          <p className="page-sub">
            Logged from MyFitnessPal, plus anything you add here. Plan a day and it sits alongside the log for
            comparison.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-4">
          <StatTile
            label="Avg energy · 30d"
            value={adherence.avgKcal.toLocaleString()}
            unit="kcal"
            meta={`Target ${adherence.targets.kcal.toLocaleString()} · within 10% on ${adherence.kcalHitRate}% of days`}
          />
          <StatTile
            label="Avg protein · 30d"
            value={adherence.avgProtein}
            unit="g"
            tone={adherence.proteinHitRate >= 70 ? 'good' : 'warning'}
            meta={`Target met on ${adherence.proteinHitRate}% of days`}
          />
          <StatTile label="Avg carbs · 30d" value={adherence.avgCarbs} unit="g" meta={`Fat ${adherence.avgFat} g`} />
          <StatTile
            label="Avg fibre · 30d"
            value={adherence.avgFiber}
            unit="g"
            tone={adherence.avgFiber >= adherence.targets.fiber_g ? 'good' : 'warning'}
            meta={`Target ${adherence.targets.fiber_g} g`}
          />
        </div>

        <Card title="Macros over the last 30 days" note="Protein, carbohydrate and fat all share the unit ‘grams’, so they share one axis. Energy is a different unit and gets its own chart below.">
          <ChartLegend
            items={[
              { label: 'Protein', color: SERIES_COLORS[0] },
              { label: 'Carbohydrate', color: SERIES_COLORS[2] },
              { label: 'Fat', color: SERIES_COLORS[1] },
            ]}
          />
          <OverlayChart
            series={[
              { id: 'protein', label: 'Protein', unit: 'g', dp: 0, color: SERIES_COLORS[0], points: protein.points },
              { id: 'carbs', label: 'Carbohydrate', unit: 'g', dp: 0, color: SERIES_COLORS[2], points: carbs.points },
              { id: 'fat', label: 'Fat', unit: 'g', dp: 0, color: SERIES_COLORS[1], points: fat.points },
            ]}
            normalized={false}
            height={240}
          />
        </Card>

        <NutritionClient initial={initial} foods={foods} kcalSeries={kcal.points} />
      </div>
    </>
  );
}

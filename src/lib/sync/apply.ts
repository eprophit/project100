import { biomarkerStatus } from '../connectors/functionHealth';
import type { NormalizedBatch } from '../connectors/types';
import { one, run, tx } from '../db';
import { today, type DayKey } from '../dates';

/**
 * The write half of ingestion, shared by every route in.
 *
 * Extracted from the sync engine because it is no longer only the sync engine's:
 * an uploaded MyFitnessPal CSV and a MyFitnessPal API page have to land in the
 * same rows, keyed the same way, or "I imported my history and now everything is
 * doubled" becomes the first bug report. One upsert, one dedupe key, two callers.
 */

export interface Counters {
  inserted: number;
  updated: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Upserts
// ---------------------------------------------------------------------------

/** Returns the newest day observed in this batch, or null if empty. */
export function applyBatch(sourceId: string, batch: NormalizedBatch, counters: Counters): DayKey | null {
  let maxDay: DayKey | null = null;
  const seen = (day: DayKey) => {
    if (day > today()) return; // never let a bad upstream date push the watermark forward
    if (!maxDay || day > maxDay) maxDay = day;
  };

  tx(() => {
    for (const w of batch.workouts ?? []) {
      const id = `${sourceId}:${w.externalId}`;
      const existed = exists('workouts', id);
      run(
        `INSERT INTO workouts (id, source_id, external_id, start_utc, day, modality, title,
            duration_s, distance_m, avg_hr, max_hr, kcal, avg_watts, norm_watts, pace_s, spm,
            load, perceived, raw)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(source_id, external_id) DO UPDATE SET
           start_utc=excluded.start_utc, day=excluded.day, modality=excluded.modality,
           title=excluded.title, duration_s=excluded.duration_s, distance_m=excluded.distance_m,
           avg_hr=excluded.avg_hr, max_hr=excluded.max_hr, kcal=excluded.kcal,
           avg_watts=excluded.avg_watts, norm_watts=excluded.norm_watts, pace_s=excluded.pace_s,
           spm=excluded.spm, load=excluded.load, perceived=excluded.perceived, raw=excluded.raw`,
        [
          id, sourceId, w.externalId, w.startUtc, w.day, w.modality, w.title ?? null,
          Math.round(w.durationS), w.distanceM ?? null, w.avgHr ?? null, w.maxHr ?? null,
          w.kcal ?? null, w.avgWatts ?? null, w.normWatts ?? null, w.paceS ?? null, w.spm ?? null,
          w.load, w.perceived ?? null, w.raw ? JSON.stringify(w.raw) : null,
        ],
      );
      bump(counters, existed);
      seen(w.day);

      // Children are replaced wholesale — cheaper and safer than diffing, and
      // an edited workout upstream can change its interval count.
      if (w.intervals) {
        run('DELETE FROM workout_intervals WHERE workout_id = ?', [id]);
        w.intervals.forEach((iv, i) =>
          run(
            `INSERT INTO workout_intervals (workout_id, idx, label, duration_s, distance_m, avg_watts, avg_hr, spm, pace_s)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [id, i, iv.label, iv.durationS ?? null, iv.distanceM ?? null, iv.avgWatts ?? null,
             iv.avgHr ?? null, iv.spm ?? null, iv.paceS ?? null],
          ),
        );
      }
      if (w.sets) {
        run('DELETE FROM strength_sets WHERE workout_id = ?', [id]);
        for (const s of w.sets) {
          run(
            `INSERT INTO strength_sets (workout_id, exercise, set_no, reps, weight_kg, rpe)
             VALUES (?,?,?,?,?,?)`,
            [id, s.exercise, s.setNo, s.reps, s.weightKg, s.rpe ?? null],
          );
        }
      }
    }

    for (const s of batch.sleep ?? []) {
      const id = `${sourceId}:${s.externalId}`;
      const existed = exists('sleep', id);
      run(
        `INSERT INTO sleep (id, source_id, external_id, day, bedtime, wake_time, total_min,
            deep_min, rem_min, light_min, awake_min, efficiency, resting_hr, respiratory_rate, raw)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(source_id, external_id) DO UPDATE SET
           day=excluded.day, bedtime=excluded.bedtime, wake_time=excluded.wake_time,
           total_min=excluded.total_min, deep_min=excluded.deep_min, rem_min=excluded.rem_min,
           light_min=excluded.light_min, awake_min=excluded.awake_min,
           efficiency=excluded.efficiency, resting_hr=excluded.resting_hr,
           respiratory_rate=excluded.respiratory_rate`,
        [
          id, sourceId, s.externalId, s.day, s.bedtime ?? null, s.wakeTime ?? null,
          s.totalMin ?? null, s.deepMin ?? null, s.remMin ?? null, s.lightMin ?? null,
          s.awakeMin ?? null, s.efficiency ?? null, s.restingHr ?? null,
          s.respiratoryRate ?? null, s.raw ? JSON.stringify(s.raw) : null,
        ],
      );
      bump(counters, existed);
      seen(s.day);
    }

    for (const r of batch.recovery ?? []) {
      const id = `${sourceId}:${r.externalId}`;
      const existed = exists('recovery', id);
      run(
        `INSERT INTO recovery (id, source_id, external_id, day, hrv_rmssd, hrv_ln, resting_hr, readiness, note, raw)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(source_id, external_id) DO UPDATE SET
           day=excluded.day, hrv_rmssd=excluded.hrv_rmssd, hrv_ln=excluded.hrv_ln,
           resting_hr=excluded.resting_hr, readiness=excluded.readiness, note=excluded.note`,
        [
          id, sourceId, r.externalId, r.day, r.hrvRmssd ?? null, r.hrvLn ?? null,
          r.restingHr ?? null, r.readiness ?? null, r.note ?? null,
          r.raw ? JSON.stringify(r.raw) : null,
        ],
      );
      bump(counters, existed);
      seen(r.day);
    }

    for (const n of batch.nutrition ?? []) {
      const id = `${sourceId}:${n.externalId}`;
      const existed = exists('nutrition_entries', id);
      const servings = n.servings ?? 1;
      const servingG = n.servingG ?? null;

      // Totals arrive already multiplied by servings. Store the snapshot on the
      // basis the provider can actually support: per 100 g when it told us what
      // a serving weighs, otherwise per serving.
      const perServing = (v: number | undefined) => (servings > 0 ? (v ?? 0) / servings : (v ?? 0));
      const basis = servingG && servingG > 0 ? 'per_100g' : 'per_serving';
      const factor = basis === 'per_100g' ? 100 / (servingG as number) : 1;
      const base = (v: number | undefined) => round4(perServing(v) * factor);

      run(
        `INSERT INTO nutrition_entries (id, source_id, external_id, day, meal, food, brand,
            quantity, unit, basis, serving_g,
            n_kcal, n_protein_g, n_carbs_g, n_fat_g, n_sat_fat_g, n_fiber_g, n_sugar_g,
            n_sodium_mg, n_potassium_mg, n_calcium_mg, n_iron_mg, n_magnesium_mg, n_zinc_mg,
            n_vit_a_mcg, n_vit_c_mg, n_vit_d_mcg, n_vit_b12_mcg, n_folate_mcg,
            n_cholesterol_mg, n_omega3_g, planned, logged_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
         ON CONFLICT(source_id, external_id) DO UPDATE SET
           day=excluded.day, meal=excluded.meal, food=excluded.food, brand=excluded.brand,
           quantity=excluded.quantity, unit=excluded.unit, basis=excluded.basis,
           serving_g=excluded.serving_g,
           n_kcal=excluded.n_kcal, n_protein_g=excluded.n_protein_g, n_carbs_g=excluded.n_carbs_g,
           n_fat_g=excluded.n_fat_g, n_sat_fat_g=excluded.n_sat_fat_g, n_fiber_g=excluded.n_fiber_g,
           n_sugar_g=excluded.n_sugar_g, n_sodium_mg=excluded.n_sodium_mg,
           n_potassium_mg=excluded.n_potassium_mg, n_calcium_mg=excluded.n_calcium_mg,
           n_iron_mg=excluded.n_iron_mg, n_magnesium_mg=excluded.n_magnesium_mg,
           n_zinc_mg=excluded.n_zinc_mg, n_vit_a_mcg=excluded.n_vit_a_mcg,
           n_vit_c_mg=excluded.n_vit_c_mg, n_vit_d_mcg=excluded.n_vit_d_mcg,
           n_vit_b12_mcg=excluded.n_vit_b12_mcg, n_folate_mcg=excluded.n_folate_mcg,
           n_cholesterol_mg=excluded.n_cholesterol_mg, n_omega3_g=excluded.n_omega3_g,
           logged_at=excluded.logged_at`,
        [
          id, sourceId, n.externalId, n.day, n.meal, n.food, n.brand ?? null,
          basis === 'per_100g' ? servings * (servingG as number) : servings,
          basis === 'per_100g' ? 'g' : 'serving',
          basis, servingG,
          base(n.kcal), base(n.proteinG), base(n.carbsG), base(n.fatG), base(n.satFatG),
          base(n.fiberG), base(n.sugarG), base(n.sodiumMg), base(n.potassiumMg),
          base(n.calciumMg), base(n.ironMg), base(n.magnesiumMg), base(n.zincMg),
          base(n.vitAMcg), base(n.vitCMg), base(n.vitDMcg), base(n.vitB12Mcg),
          base(n.folateMcg), base(n.cholesterolMg), base(n.omega3G),
          n.loggedAt ?? null,
        ],
      );
      bump(counters, existed);
      seen(n.day);
    }

    for (const b of batch.body ?? []) {
      const id = `${sourceId}:${b.externalId}`;
      const existed = exists('body_metrics', id);
      run(
        `INSERT INTO body_metrics (id, source_id, external_id, day, weight_kg, bodyfat_pct, lean_mass_kg, vo2max)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(source_id, external_id) DO UPDATE SET
           day=excluded.day, weight_kg=excluded.weight_kg, bodyfat_pct=excluded.bodyfat_pct,
           lean_mass_kg=excluded.lean_mass_kg, vo2max=excluded.vo2max`,
        [id, sourceId, b.externalId, b.day, b.weightKg ?? null, b.bodyfatPct ?? null,
         b.leanMassKg ?? null, b.vo2max ?? null],
      );
      bump(counters, existed);
      seen(b.day);
    }

    for (const m of batch.biomarkers ?? []) {
      const id = `${sourceId}:${m.externalId}`;
      const existed = exists('biomarkers', id);
      const status = biomarkerStatus({
        value: m.value,
        ref_low: m.refLow ?? null,
        ref_high: m.refHigh ?? null,
        optimal_low: m.optimalLow ?? null,
        optimal_high: m.optimalHigh ?? null,
      });
      run(
        `INSERT INTO biomarkers (id, source_id, external_id, day, panel, category, name, slug,
            value, unit, ref_low, ref_high, optimal_low, optimal_high, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(source_id, external_id) DO UPDATE SET
           day=excluded.day, panel=excluded.panel, category=excluded.category, name=excluded.name,
           value=excluded.value, unit=excluded.unit, ref_low=excluded.ref_low,
           ref_high=excluded.ref_high, optimal_low=excluded.optimal_low,
           optimal_high=excluded.optimal_high, status=excluded.status`,
        [
          id, sourceId, m.externalId, m.day, m.panel ?? null, m.category, m.name, m.slug,
          m.value, m.unit ?? null, m.refLow ?? null, m.refHigh ?? null,
          m.optimalLow ?? null, m.optimalHigh ?? null, status,
        ],
      );
      bump(counters, existed);
      seen(m.day);
    }

    for (const p of batch.protocols ?? []) {
      const id = `${sourceId}:${p.externalId}`;
      const existed = exists('protocols', id);
      run(
        `INSERT INTO protocols (id, source_id, external_id, day, kind, minutes, intensity, notes)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(source_id, external_id) DO UPDATE SET
           day=excluded.day, kind=excluded.kind, minutes=excluded.minutes,
           intensity=excluded.intensity, notes=excluded.notes`,
        [id, sourceId, p.externalId, p.day, p.kind, p.minutes ?? null, p.intensity ?? null, p.notes ?? null],
      );
      bump(counters, existed);
      seen(p.day);
    }
  });

  return maxDay;
}

function exists(table: string, id: string): boolean {
  return one<{ n: number }>(`SELECT 1 AS n FROM ${table} WHERE id = ?`, [id]) !== null;
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

function bump(counters: Counters, existed: boolean): void {
  if (existed) counters.updated += 1;
  else counters.inserted += 1;
}

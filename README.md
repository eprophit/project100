# Vitalis

A prototype health OS: one timeline for training, nutrition, supplements, recovery protocols, sleep and bloodwork, pulled in on a schedule from the services that already hold that data.

```bash
npm install
npm run dev          # http://localhost:3000
```

There is no setup step. The first request creates the SQLite database, registers the connectors, and runs a full backfill; after that it's incremental.

---

## What it does

| Page | |
|---|---|
| **Today** | Readiness, HRV against a 60-day baseline, sleep, load balance, fuel, supplements, latest panel |
| **Explorer** | Overlay any metrics from any source on one timeline, with lag correlation |
| **Coach** | Chat with a model that can read your data through eight tools |
| **Training** | Per-modality progress, each on the measure that matters for it |
| **Nutrition** | Food log, meal planner, reusable meal/day/week templates, per-item nutrient panels, macro targets, 30-day adherence |
| **Recovery** | Sleep architecture, supplement stack, sauna/cold/breathwork logging |
| **Biomarkers** | Panels over time against reference *and* optimal ranges |
| **Connections** | Connector status, watermarks, and every sync run with what it cost |

---

## Ingestion

Six connectors feed one normalised schema:

| Source | Domains | Wire-format quirks the mapper absorbs |
|---|---|---|
| **Function Health** | biomarkers | Panel documents; status derived rather than trusted, since providers disagree on whether "optimal" is a subset of "in range" |
| **MyFitnessPal** | nutrition | One document per day with nested `meals[].entries[]` that carry no day of their own; nutrients stored *per serving* and multiplied by `servings`; several micronutrients reported as a **% of a daily value** rather than an amount; diary entries carry no weight, so they stay per-serving downstream |
| **Apple Health** | sleep, body, workouts | Flat heterogeneous samples: sleep arrives as per-stage segments folded into one night keyed to the **wake** day; body-fat is a fraction, not a percentage; duration in minutes, distance in km; set-level lifting data only exists as a JSON string inside workout metadata |
| **ErgData** (Concept2) | workouts | `time` in **tenths of a second**; naive local timestamps; splits carry `split_time`, not a pace |
| **Peloton** | workouts | Unix-second timestamps; `total_work` in **joules**; distance in **miles**; title on the nested `ride` |
| **HRV4Training** | recovery | **CSV**, not JSON — the connector returns raw lines and parses them in `normalize()` |

### The engine is real; only the transport is simulated

Connectors run in **demo mode** until you supply a credential. Demo mode does not shortcut the pipeline — it swaps the vendor's servers for a local fixture and keeps everything above it:

- pages the upstream with opaque cursors,
- fails ~8% of first attempts with 429/503 and recovers on retry with backoff,
- maps vendor field names into the shared schema,
- upserts on `(source_id, external_id)` inside a transaction,
- advances a watermark only as far as data it actually observed.

The first page of every pass deliberately re-fetches the boundary day to pick up late edits upstream. That is safe precisely because the upsert makes it idempotent — the Connections page shows a second sync inserting **0** rows and updating the ones it re-read.

To go live, set the credential (see `.env.example`) and implement the live branch of that connector's `fetchPage`. Nothing above it changes.

### The demo data is not noise

`src/lib/sim/athlete.ts` generates a deterministic 400-day history where the signals actually relate to each other: HRV and resting HR respond to acute-load strain and sleep debt, intake tracks expenditure, biomarkers drift with training age, and the plan runs a 3-week build / 1-week deload cycle. That is what makes the Explorer worth looking at — the correlation panel reports real structure rather than r ≈ 0.

Typical values over 180 days:

```
HRV vs acute load        r = -0.37   (harder recent training → lower HRV)
resting HR vs acute load r = +0.28
readiness vs acute load  r = -0.37
HRV vs sleep duration    r = +0.41
intake vs training load  r = +0.31
```

---

## Charts

Two rules drive the chart layer, both in `src/components/charts.tsx`:

**No dual axes.** Overlaying metrics with different units z-scores them onto one shared axis and shows real values on hover; if you'd rather see real values, "Small multiples" gives each metric its own chart. A second y-scale is never the answer. Where metrics genuinely share a unit — acute vs chronic load, deep vs REM sleep, protein vs carbs vs fat — they're plotted at their real values on one axis.

**Series colours are assigned by slot, never cycled.** The palette in `src/lib/palette.ts` is the validated categorical set, verified against the chart surface for the lightness band, chroma floor, colourblind separation (worst adjacent ΔE 8.4), normal-vision separation (19.3) and 3:1 contrast. The picker stops at eight rather than inventing a ninth hue. Status colours are reserved and always ship with a glyph and a word, never colour alone.

---

## Nutrition planning

The nutrition tab is built for someone who eats roughly the same things most days and plans the week ahead, so it is organised around reuse rather than around one-off entry.

**Everything is stored per 100 g.** That is the only basis on which grams, ounces and servings are interchangeable — a serving is just a named number of grams — so switching the unit on a logged item is arithmetic, not a re-entry. Clicking any item opens its full panel: macros, carbohydrate and fat detail, minerals and vitamins, shown both for the amount actually logged and per 100 g, with % of a reference daily intake.

MyFitnessPal entries are the exception, deliberately. A diary entry for a "poke bowl" has no weight attached, so those rows carry a per-serving snapshot and are marked as such: the quantity is still editable, but the app refuses to express them in grams because nothing knows what one weighs. Guessing would be worse than declining.

**Four levels of reuse**, each saved independently:

| | |
|---|---|
| **Item** | A food from the catalog at a specific amount |
| **Meal** | A named set of items — "Chicken & rice bowl" |
| **Day** | A set of *meal templates* by slot — "Hard training day" |
| **Week** | Seven day templates, Monday-indexed — "Standard training week" |

A saved day **references** its meals rather than copying them, so correcting a meal corrects every day built on it. Applying a template to a date does the opposite: it materialises independent entries that can then diverge without editing the template. Templates are the recipe; entries are the record.

Applying a week rolls seven days out in one action. "Replace what's already there" clears only the app's own rows — imported MyFitnessPal entries are never destroyed by a template application.

Because `nutrition_entries` rows carry their own nutrient snapshot, editing the catalog later never silently rewrites history. The trade-off is that the amount → nutrients multiplier exists twice, once in TypeScript and once in SQL (range aggregates would otherwise pull every row into JS). `npm run check` compares the two on real rows and reports any disagreement.

---

## Coach

`POST /api/chat` streams newline-delimited JSON so the UI can render tool calls as they happen. The model gets eight read-only tools over the same query layer the pages use, so a number in chat and a number on a chart cannot disagree:

`list_metrics` · `query_metric` · `correlate_metrics` · `get_daily_summary` · `get_training` · `get_nutrition` · `get_biomarkers` · `get_recovery_protocols`

Tool results are summary statistics plus a downsampled series rather than raw daily values — handing a model 400 numbers wastes context and makes its arithmetic worse, not better.

**Without an API key the feature still works.** It falls back to a keyword-routed analyst that calls the same tools and composes an answer from them, clearly labelled as offline mode in the UI. Set `ANTHROPIC_API_KEY` in `.env.local` for the real thing.

---

## Layout

```
src/
  lib/
    sim/athlete.ts        deterministic upstream (the "vendor servers")
    connectors/           six connectors + shared transport & types
    sync/engine.ts        paging, retry, dedupe, upsert, watermarks
    metrics.ts            metric catalog, smoothing, z-score, lag correlation
    nutrition.ts          nutrient vector, unit conversion, display metadata
    foods.ts              per-100 g food catalog with micronutrients
    templates.ts          starter meal / day / week templates
    mealPlans.ts          the reusable-plan layer: item → meal → day → week
    queries.ts            read layer shared by pages and coach tools
    coach/                tool definitions, executor, offline analyst
    db.ts                 schema + node:sqlite access
    palette.ts            validated chart palette
  app/                    pages and API routes
  components/             charts and UI atoms
scripts/
  check.ts                pipeline smoke test — run with `npm run check`
  shots.mjs               screenshots every page — `npm run shots`
```

`npm run check` runs the real bootstrap, re-syncs to prove idempotency, prints coverage and correlations, and asserts there are no duplicate keys and no silent holes in the training history. Storage is Node's built-in `node:sqlite`, so there are no native dependencies.

---

## Known limits

- **Single user, no auth.** Everything is local to `data/vitalis.db`.
- **Correlations are observational**, on one person, with training phase and season moving most signals together. The UI says so next to the numbers; treat a strong r as a prompt to investigate, not evidence of cause.
- **Biomarker values are for tracking trends**, not diagnosis.
- **Live connector branches are stubs.** Setting a credential switches the connector to live mode and it will tell you exactly which function to implement.
- **Nutrient figures are catalog references**, not assays of the item on your plate, and % RDI is a general adult reference rather than a target tuned to this training load.
- **Sync is manual or on first boot** — there's no scheduler yet. The engine is written to be driven by one (`syncAll()` is a single call).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Storage layer. Uses Node's built-in SQLite so the prototype has zero native
 * dependencies — `npm install && npm run dev` is the whole setup.
 *
 * Everything below goes through `getDb()`, which is memoised per process. Next
 * dev-mode module reloading would otherwise open a new handle on every request,
 * so the instance is parked on `globalThis`.
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Connector registry. One row per upstream provider; holds the incremental
-- sync cursor so a batch pull only asks for what it hasn't seen.
CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  vendor        TEXT NOT NULL,
  domains       TEXT NOT NULL,          -- JSON array of DomainKind
  auth_mode     TEXT NOT NULL,          -- oauth | token | file_export
  enabled       INTEGER NOT NULL DEFAULT 1,
  mode          TEXT NOT NULL DEFAULT 'demo',   -- demo | live
  cursor        TEXT,                   -- opaque, provider-defined
  last_sync_at  TEXT,
  last_status   TEXT,
  last_error    TEXT
);

-- One row per batch pull attempt, per source. This is the audit trail the
-- Connections page renders.
CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,            -- running | ok | partial | error
  pages       INTEGER NOT NULL DEFAULT 0,
  fetched     INTEGER NOT NULL DEFAULT 0,
  inserted    INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  retries     INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON sync_runs(source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS workouts (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  external_id TEXT NOT NULL,
  start_utc   TEXT NOT NULL,
  day         TEXT NOT NULL,            -- YYYY-MM-DD, local-to-user day key
  modality    TEXT NOT NULL,            -- rowing | cycling | running | strength | swimming | walking | mobility
  title       TEXT,
  duration_s  INTEGER NOT NULL DEFAULT 0,
  distance_m  REAL,
  avg_hr      REAL,
  max_hr      REAL,
  kcal        REAL,
  avg_watts   REAL,
  norm_watts  REAL,
  pace_s      REAL,                     -- s/500m for rowing, s/km for run
  spm         REAL,                     -- strokes or steps per minute
  load        REAL NOT NULL DEFAULT 0,  -- normalised training load
  perceived   INTEGER,                  -- RPE 1-10 where reported
  raw         TEXT,
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_workouts_day ON workouts(day);
CREATE INDEX IF NOT EXISTS idx_workouts_modality ON workouts(modality, day);

CREATE TABLE IF NOT EXISTS workout_intervals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  label      TEXT,
  duration_s REAL,
  distance_m REAL,
  avg_watts  REAL,
  avg_hr     REAL,
  spm        REAL,
  pace_s     REAL,
  UNIQUE(workout_id, idx)
);

CREATE TABLE IF NOT EXISTS strength_sets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise   TEXT NOT NULL,
  set_no     INTEGER NOT NULL,
  reps       INTEGER NOT NULL,
  weight_kg  REAL NOT NULL,
  rpe        REAL,
  UNIQUE(workout_id, exercise, set_no)
);
CREATE INDEX IF NOT EXISTS idx_sets_exercise ON strength_sets(exercise);

CREATE TABLE IF NOT EXISTS sleep (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  day          TEXT NOT NULL,
  bedtime      TEXT,
  wake_time    TEXT,
  total_min    REAL,
  deep_min     REAL,
  rem_min      REAL,
  light_min    REAL,
  awake_min    REAL,
  efficiency   REAL,
  resting_hr   REAL,
  respiratory_rate REAL,
  raw          TEXT,
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_sleep_day ON sleep(day);

CREATE TABLE IF NOT EXISTS recovery (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  external_id TEXT NOT NULL,
  day         TEXT NOT NULL,
  hrv_rmssd   REAL,
  hrv_ln      REAL,
  resting_hr  REAL,
  readiness   REAL,
  note        TEXT,
  raw         TEXT,
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_recovery_day ON recovery(day);

-- Sauna, cold exposure, mobility, massage, breathwork, etc.
CREATE TABLE IF NOT EXISTS protocols (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  external_id TEXT NOT NULL,
  day         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  minutes     REAL,
  intensity   TEXT,
  notes       TEXT,
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_protocols_day ON protocols(day, kind);

CREATE TABLE IF NOT EXISTS foods (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  brand      TEXT,
  serving    TEXT NOT NULL,
  serving_g  REAL,
  kcal       REAL NOT NULL,
  protein_g  REAL NOT NULL DEFAULT 0,
  carbs_g    REAL NOT NULL DEFAULT 0,
  fat_g      REAL NOT NULL DEFAULT 0,
  fiber_g    REAL NOT NULL DEFAULT 0,
  sugar_g    REAL NOT NULL DEFAULT 0,
  sodium_mg  REAL NOT NULL DEFAULT 0,
  tags       TEXT
);
CREATE INDEX IF NOT EXISTS idx_foods_name ON foods(name);

-- planned = 1 rows are the meal planner; planned = 0 rows are the food log.
-- Same table so "did I eat what I planned?" is one query.
CREATE TABLE IF NOT EXISTS nutrition_entries (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL,
  external_id TEXT NOT NULL,
  day         TEXT NOT NULL,
  meal        TEXT NOT NULL,            -- breakfast | lunch | dinner | snack | intra
  food_id     TEXT,
  food        TEXT NOT NULL,
  brand       TEXT,
  servings    REAL NOT NULL DEFAULT 1,
  kcal        REAL NOT NULL DEFAULT 0,
  protein_g   REAL NOT NULL DEFAULT 0,
  carbs_g     REAL NOT NULL DEFAULT 0,
  fat_g       REAL NOT NULL DEFAULT 0,
  fiber_g     REAL NOT NULL DEFAULT 0,
  sugar_g     REAL NOT NULL DEFAULT 0,
  sodium_mg   REAL NOT NULL DEFAULT 0,
  planned     INTEGER NOT NULL DEFAULT 0,
  logged_at   TEXT,
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_nutrition_day ON nutrition_entries(day, planned);

CREATE TABLE IF NOT EXISTS supplements (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  brand     TEXT,
  dose      REAL,
  unit      TEXT,
  timing    TEXT,                       -- am | pm | pre | post | with_meal
  purpose   TEXT,
  cadence   TEXT NOT NULL DEFAULT 'daily',  -- daily | training_days | weekly
  active    INTEGER NOT NULL DEFAULT 1,
  started_on TEXT,
  notes     TEXT
);

CREATE TABLE IF NOT EXISTS supplement_logs (
  id            TEXT PRIMARY KEY,
  supplement_id TEXT NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  taken         INTEGER NOT NULL DEFAULT 1,
  dose          REAL,
  source_id     TEXT,
  UNIQUE(supplement_id, day)
);
CREATE INDEX IF NOT EXISTS idx_supp_logs_day ON supplement_logs(day);

CREATE TABLE IF NOT EXISTS body_metrics (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  day          TEXT NOT NULL,
  weight_kg    REAL,
  bodyfat_pct  REAL,
  lean_mass_kg REAL,
  vo2max       REAL,
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_body_day ON body_metrics(day);

CREATE TABLE IF NOT EXISTS biomarkers (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  day          TEXT NOT NULL,           -- collection date
  panel        TEXT,
  category     TEXT NOT NULL,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  value        REAL NOT NULL,
  unit         TEXT,
  ref_low      REAL,
  ref_high     REAL,
  optimal_low  REAL,
  optimal_high REAL,
  status       TEXT,                    -- optimal | in_range | out_of_range
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_biomarkers_slug ON biomarkers(slug, day);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  TEXT NOT NULL,
  role       TEXT NOT NULL,             -- user | assistant
  content    TEXT NOT NULL,
  tool_trace TEXT,                      -- JSON array of {tool, input, summary}
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_thread ON chat_messages(thread_id, id);
`;

declare global {
  // eslint-disable-next-line no-var
  var __vitalisDb: DatabaseSync | undefined;
}

export function dbPath(): string {
  const configured = process.env.VITALIS_DB;
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), 'data', 'vitalis.db');
}

export function getDb(): DatabaseSync {
  if (globalThis.__vitalisDb) return globalThis.__vitalisDb;

  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  globalThis.__vitalisDb = db;
  return db;
}

/**
 * `node:sqlite` hands back null-prototype objects. React Server Components
 * refuse to serialise those across the server/client boundary, so every row is
 * rehydrated into a plain object here rather than at each call site.
 */
function plain<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

/** `SELECT` returning many rows, typed by the caller. */
export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return (stmt.all(...(params as never[])) as unknown[]).map((r) => plain<T>(r));
}

/** `SELECT` returning at most one row. */
export function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
  const stmt = getDb().prepare(sql);
  const row = stmt.get(...(params as never[]));
  return row == null ? null : plain<T>(row);
}

export function run(sql: string, params: unknown[] = []): void {
  const stmt = getDb().prepare(sql);
  stmt.run(...(params as never[]));
}

/** Wraps `fn` in a transaction; rolls back and rethrows on error. */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(key: string): string | null {
  const row = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

export function getJsonSetting<T>(key: string, fallback: T): T {
  const raw = getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

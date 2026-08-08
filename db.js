// Permanent local store for everything ever fetched from Intervals.icu.
// data.json / details/*.json stay as the fast, disposable files the dashboard reads —
// this DB is the thing that never forgets, even after an activity ages out of the
// DAYS_BACK window or someone deletes the generated files.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const DB_PATH = path.join(__dirname, "dashboard.db");

function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runners (
      id TEXT PRIMARY KEY,
      name TEXT,
      device TEXT
    );
    CREATE TABLE IF NOT EXISTS activities (
      activityId TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      activityName TEXT,
      activityType TEXT,
      startTimeInSeconds INTEGER NOT NULL,
      distanceInMeters INTEGER,
      durationInSeconds INTEGER,
      averageHeartRateInBeatsPerMinute INTEGER,
      deviceName TEXT,
      fetchedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_details (
      activityId TEXT PRIMARY KEY,
      lapsJson TEXT,
      streamsJson TEXT,
      fetchedAt TEXT NOT NULL
    );
    -- Deliberately narrow: Intervals.icu's wellness record also carries mood, stress,
    -- bodyFat, bloodGlucose, menstrualPhase, etc. Only sleep fields are asked for here
    -- and only sleep fields are ever written to this table.
    CREATE TABLE IF NOT EXISTS sleep (
      ownerId TEXT NOT NULL,
      date TEXT NOT NULL,
      sleepSecs INTEGER,
      sleepScore REAL,
      sleepQuality INTEGER,
      avgSleepingHR INTEGER,
      fetchedAt TEXT NOT NULL,
      PRIMARY KEY (ownerId, date)
    );
    -- plan.csv only ever holds "the current plan" — it gets overwritten by hand each
    -- week. This table is what actually remembers past weeks: every fetch-data.js run
    -- snapshots that week's plan under its Sunday date, so re-running mid-week just
    -- updates that week's row (idempotent) instead of creating duplicates.
    CREATE TABLE IF NOT EXISTS plan_history (
      ownerId TEXT NOT NULL,
      weekStart TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      text TEXT,
      fetchedAt TEXT NOT NULL,
      PRIMARY KEY (ownerId, weekStart, weekday)
    );
  `);
  return db;
}

module.exports = { openDb, DB_PATH };

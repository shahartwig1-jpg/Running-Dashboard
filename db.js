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
  `);
  return db;
}

module.exports = { openDb, DB_PATH };

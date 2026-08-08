/*
 * One-time migration: copies everything already in the local dashboard.db (SQLite)
 * into Supabase, so history collected before the move isn't lost.
 *
 *   node migrate-to-supabase.js
 *
 * Safe to re-run — everything is upserted, so running it twice just re-writes the same rows.
 * Needs supabase-url.txt / supabase-key.txt filled in first.
 */
const { openDb } = require("./db");
const supa = require("./supabase");

(async () => {
  const db = openDb();

  const runners = db.prepare(`SELECT id, name, device FROM runners`).all();
  const activities = db.prepare(`SELECT * FROM activities`).all();
  const details = db.prepare(`SELECT * FROM activity_details`).all();
  const sleep = db.prepare(`SELECT * FROM sleep`).all();
  const planRows = db.prepare(`SELECT * FROM plan_history`).all();
  db.close();

  console.log(`Local DB: ${runners.length} runners, ${activities.length} activities, ${details.length} activity details, ${sleep.length} sleep nights, ${planRows.length} plan-history rows.`);

  if (runners.length) await supa.upsertRunners(runners);
  console.log("Runners migrated.");

  if (activities.length) await supa.upsertActivities(activities);
  console.log("Activities migrated.");

  for (const d of details) {
    await supa.upsertActivityDetail(
      d.activityId,
      d.lapsJson ? JSON.parse(d.lapsJson) : [],
      d.streamsJson ? JSON.parse(d.streamsJson) : null,
      d.fetchedAt
    );
  }
  console.log(`Activity details migrated (${details.length}).`);

  if (sleep.length) await supa.upsertSleep(sleep);
  console.log("Sleep migrated.");

  if (planRows.length) await supa.upsertPlanDays(planRows);
  console.log("Plan history migrated.");

  console.log("\nDone. dashboard.db is left untouched as a local backup — safe to keep or delete once you've confirmed Supabase has everything.");
})().catch(e => {
  console.error("Migration failed:", e.message);
  if (e.body) console.error(e.body);
  process.exit(1);
});

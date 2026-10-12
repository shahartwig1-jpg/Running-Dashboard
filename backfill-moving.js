// One-off: fills activities."movingSeconds" for runs the sync no longer reaches (older than its ~10-week window),
// from the lap times already saved in activity_details (each lap's time is moving time). No Intervals.icu calls.
// A run is only filled when its laps cover the whole run (within 2% of its distance); the rest keep using the
// timer time. Needs supabase/run_descriptions.sql to have been run.  Usage: node backfill-moving.js [--dry]
const { rest } = require("./records");

const DRY = process.argv.includes("--dry");

(async () => {
  const missing = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest("GET", `activities?select=activityId,distanceInMeters,durationInSeconds&movingSeconds=is.null&distanceInMeters=gt.0&limit=1000&offset=${offset}`);
    missing.push(...page);
    if (page.length < 1000) break;
  }
  console.log(`${missing.length} run(s) without a moving time`);

  let filled = 0, skipped = 0;
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const ids = batch.map(a => encodeURIComponent(a.activityId)).join(",");
    const details = await rest("GET", `activity_details?select=activityId,laps&activityId=in.(${ids})`);
    const lapsById = Object.fromEntries(details.map(d => [d.activityId, d.laps || []]));
    for (const a of batch) {
      const laps = lapsById[a.activityId] || [];
      const lapDist = laps.reduce((t, l) => t + (l.distanceInMeters || 0), 0);
      const moving = laps.reduce((t, l) => t + (l.durationInSeconds || 0), 0);
      // Laps must cover the run, and moving time can never be longer than the timer time.
      if (!laps.length || Math.abs(lapDist - a.distanceInMeters) > a.distanceInMeters * 0.02 || moving <= 0 || moving > a.durationInSeconds) { skipped++; continue; }
      if (!DRY) await rest("PATCH", `activities?activityId=eq.${encodeURIComponent(a.activityId)}`, { body: { movingSeconds: moving }, prefer: "return=minimal" });
      filled++;
    }
  }
  console.log(`${DRY ? "[dry run] would fill" : "Filled"} ${filled}, left ${skipped} on timer time (no laps, or laps don't cover the run)`);
})().catch(e => { console.error(e.message); process.exit(1); });

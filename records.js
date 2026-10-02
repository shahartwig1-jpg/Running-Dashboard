// Keeps the `records` table (supabase/records.sql) up to date. For every runner it walks their
// runs oldest -> newest and saves each run that beat their previous best at a tracked distance.
// Called by fetch-data.js after every sync; also runnable on its own:  node records.js
//
// A "10K" run is one recorded between 10.0 and 10.5 km; its 10K time is scaled to exactly
// 10 km (duration x 10000 / distance), so a watch that logged 10.12 km isn't unfairly slow.
// Limit: a fast 10 km hidden inside a longer run (e.g. a half marathon) is not counted -- that
// would need the per-second distance stream, which is only kept for the last few runs.
const fs = require("fs");
const path = require("path");

const DISTANCES = [{ key: "10k", meters: 10000, maxMeters: 10500 }];

function creds() {
  const read = f => (fs.existsSync(path.join(__dirname, f)) ? fs.readFileSync(path.join(__dirname, f), "utf8").trim() : "");
  const url = process.env.SUPABASE_URL || read("supabase-url.txt");
  const key = process.env.SUPABASE_SERVICE_KEY || read("supabase-key.txt");
  if (!url || !key) throw new Error("missing Supabase credentials");
  return { url: url.replace(/\/$/, ""), key };
}

async function rest(method, pathAndQuery, { body, prefer } = {}) {
  const { url, key } = creds();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathAndQuery.split("?")[0]} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchAll(table, query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest("GET", `${table}?${query}&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// Pure function: activities in, record-progression rows out.
function computeRecords(activities) {
  const out = [];
  const byOwner = new Map();
  for (const a of activities) {
    if (!byOwner.has(a.ownerId)) byOwner.set(a.ownerId, []);
    byOwner.get(a.ownerId).push(a);
  }
  for (const [ownerId, runs] of byOwner) {
    runs.sort((x, y) => x.startTimeInSeconds - y.startTimeInSeconds);
    for (const d of DISTANCES) {
      let best = null;
      for (const a of runs) {
        if (!(a.distanceInMeters >= d.meters && a.distanceInMeters <= d.maxMeters && a.durationInSeconds > 0)) continue;
        const seconds = Math.round(a.durationInSeconds * d.meters / a.distanceInMeters);
        if (best === null || seconds < best) {
          out.push({
            ownerId: String(ownerId), distance: d.key, seconds, activityId: String(a.activityId),
            startTimeInSeconds: a.startTimeInSeconds, previousSeconds: best,
          });
          best = seconds;
        }
      }
    }
  }
  return out;
}

async function updateRecords() {
  const activities = await fetchAll("activities", "select=ownerId,activityId,startTimeInSeconds,distanceInMeters,durationInSeconds&order=startTimeInSeconds.asc");
  const computed = computeRecords(activities);
  if (computed.length) {
    await rest("POST", "records?on_conflict=ownerId,distance,activityId", { body: computed, prefer: "resolution=merge-duplicates,return=minimal" });
  }
  // A record whose run was later deleted from the dashboard must not linger.
  const keep = new Set(computed.map(r => r.activityId));
  const existing = await fetchAll("records", "select=activityId");
  const stale = existing.map(r => r.activityId).filter(id => !keep.has(id));
  if (stale.length) {
    await rest("DELETE", `records?activityId=in.(${stale.map(encodeURIComponent).join(",")})`);
  }
  console.log(`Records: ${computed.length} record run(s) saved across ${new Set(computed.map(r => r.ownerId)).size} runner(s)` +
    (stale.length ? `, removed ${stale.length} stale` : ""));
}

module.exports = { updateRecords, computeRecords };

if (require.main === module) {
  updateRecords().catch(e => { console.error("Records update failed:", e.message); process.exit(1); });
}

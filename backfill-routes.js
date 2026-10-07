// One-off: adds the map route (see route.js) to runs whose stored details don't have one yet.
// New runs get theirs from fetch-data.js automatically; this only catches up the existing ones.
// Safe to re-run: runs that already have a `route` are skipped. Usage:  node backfill-routes.js [--dry]
const fs = require("fs");
const path = require("path");
const { routeFromStreams } = require("./route");

const DRY = process.argv.includes("--dry");
const read = f => (fs.existsSync(path.join(__dirname, f)) ? fs.readFileSync(path.join(__dirname, f), "utf8").trim() : "");
const SUPA_URL = (process.env.SUPABASE_URL || read("supabase-url.txt")).replace(/\/$/, "");
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || read("supabase-key.txt");
const cfg = JSON.parse(read("config.json") || "{}");
const coachKey = cfg.apiKey || read("key.txt");
const keyByOwner = Object.fromEntries((cfg.athletes || []).map(a => [String(a.id), a.apiKey || coachKey]));

const supa = (method, p, body) => fetch(`${SUPA_URL}/rest/v1/${p}`, {
  method, headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
  body: body ? JSON.stringify(body) : undefined,
});
const supaGet = async p => { const r = await supa("GET", p); if (!r.ok) throw new Error(`GET ${p.split("?")[0]} -> ${r.status}`); return r.json(); };

const sleep = ms => new Promise(r => setTimeout(r, ms));
// One request at a time with a pause between them, and a wait-and-retry whenever Intervals.icu says
// "slow down" (429) -- the API is shared with the daily sync, so be a good citizen.
async function streamsFor(apiKey, id) {
  const auth = "Basic " + Buffer.from("API_KEY:" + apiKey).toString("base64");
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`https://intervals.icu/api/v1/activity/${id}/streams.json?types=latlng`, { headers: { Authorization: auth } });
    if (r.status === 429 && attempt <= 6) { await sleep((Number(r.headers.get("retry-after")) || 5 * attempt) * 1000); continue; }
    if (!r.ok) throw new Error(`streams ${id} -> ${r.status}`);
    return r.json();
  }
}

(async () => {
  const owners = Object.fromEntries((await supaGet("activities?select=activityId,ownerId&limit=2000")).map(a => [a.activityId, String(a.ownerId)]));
  const todo = [];
  for (let off = 0; ; off += 100) {
    const page = await supaGet(`activity_details?select=activityId,streams&order=activityId&limit=100&offset=${off}`);
    for (const row of page) if (row.streams && !("route" in row.streams) && owners[row.activityId]) todo.push(row);
    if (page.length < 100) break;
  }
  console.log(`${todo.length} run(s) need a route${DRY ? " (dry run, nothing will be written)" : ""}`);
  let done = 0, withMap = 0, failed = 0, i = 0;
  async function worker() {
    while (i < todo.length) {
      const row = todo[i++];
      try {
        const route = routeFromStreams(await streamsFor(keyByOwner[owners[row.activityId]] || coachKey, row.activityId));
        if (route.length) withMap++;
        if (!DRY) {
          const r = await supa("PATCH", `activity_details?activityId=eq.${encodeURIComponent(row.activityId)}`, { streams: { ...row.streams, route } });
          if (!r.ok) throw new Error(`save -> ${r.status}`);
        }
        done++;
      } catch (e) { failed++; console.error(`  ${row.activityId}: ${e.message}`); }
      if ((done + failed) % 50 === 0) console.log(`  ...${done + failed}/${todo.length}`);
      await sleep(400);
    }
  }
  await worker();
  console.log(`Done: ${done} processed (${withMap} with a map, ${done - withMap} without GPS or too short), ${failed} failed.`);
})().catch(e => { console.error("Backfill failed:", e.message); process.exit(1); });

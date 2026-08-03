/*
 * Pulls activities from the Intervals.icu API and writes data.json for the dashboard.
 *
 *   node fetch-data.js discover   inspect what this API key can reach, and dump one
 *                                 raw activity so the field mapping can be verified
 *   node fetch-data.js            fetch everyone in config.json -> data.json
 *
 * Credentials live in config.json, which is never committed.
 */

const fs = require("fs");
const path = require("path");
const { openDb } = require("./db");

const BASE = "https://intervals.icu/api/v1";
const CONFIG_PATH = path.join(__dirname, "config.json");
const KEY_PATH = path.join(__dirname, "key.txt"); // holds only the key, so there is no syntax to break
const OUT_PATH = path.join(__dirname, "data.json");
const DAYS_BACK = 70; // ~10 weeks, enough for the 8-week trend plus slack
const DETAIL_DIR = path.join(__dirname, "details"); // per-activity laps + streams, one file each
const STREAM_TYPES = "time,heartrate,distance,altitude,velocity_smooth";

function loadConfig() {
  // In CI (GitHub Actions) there is no config.json/key.txt on disk — the roster and
  // key come from repo secrets as env vars instead. Local runs are unaffected.
  let cfg;
  if (process.env.ATHLETES_JSON) {
    try {
      cfg = { athletes: JSON.parse(process.env.ATHLETES_JSON) };
    } catch (e) {
      console.error("ATHLETES_JSON env var is not valid JSON — " + e.message);
      process.exit(1);
    }
  } else {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.error("Missing config.json. Copy config.example.json to config.json and fill it in.");
      process.exit(1);
    }
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch (e) {
      // Hand-edited file: report the shape problem, never echo the contents.
      console.error("config.json is not valid JSON — " + e.message);
      console.error('Most likely a missing quote. The key line must look exactly like:  "apiKey": "your-key-here",');
      process.exit(1);
    }
  }

  if (process.env.INTERVALS_API_KEY) {
    cfg.apiKey = process.env.INTERVALS_API_KEY;
  } else if (fs.existsSync(KEY_PATH)) {
    // key.txt wins over config.json if present — it is the paste target, config.json only holds the roster.
    const fromFile = fs.readFileSync(KEY_PATH, "utf8").trim();
    if (fromFile) cfg.apiKey = fromFile;
  }
  if (!cfg.apiKey || cfg.apiKey.startsWith("PASTE")) {
    console.error("No API key yet. Paste it into key.txt (the file should contain the key and nothing else),");
    console.error("then save. Get it at intervals.icu > Settings > Developer Settings > API Key.");
    process.exit(1);
  }
  return cfg;
}

function authHeader(apiKey) {
  return "Basic " + Buffer.from("API_KEY:" + apiKey).toString("base64");
}

async function call(apiKey, endpoint) {
  const res = await fetch(BASE + endpoint, { headers: { Authorization: authHeader(apiKey) } });
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} on ${endpoint}`);
    err.status = res.status;
    err.body = body.slice(0, 300);
    throw err;
  }
  return JSON.parse(body);
}

const isoDaysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/* Intervals.icu largely mirrors the Strava activity schema, but field presence
   varies by source device. Each getter falls through the plausible names so a
   missing one degrades to null instead of breaking the dashboard. */
const pick = (o, ...keys) => { for (const k of keys) if (o[k] != null) return o[k]; return null; };

function normalize(a, athleteId) {
  const distance = pick(a, "distance", "icu_distance");
  const moving = pick(a, "moving_time", "icu_moving_time", "elapsed_time");
  return {
    activityId: a.id,
    ownerId: athleteId,
    activityName: pick(a, "name") || "ריצה",
    activityType: pick(a, "type", "sport") || "Run",
    startTimeInSeconds: Math.floor(new Date(pick(a, "start_date_local", "start_date")).getTime() / 1000),
    distanceInMeters: distance != null ? Math.round(distance) : null,
    durationInSeconds: moving != null ? Math.round(moving) : null,
    averageHeartRateInBeatsPerMinute: pick(a, "average_heartrate", "icu_average_heartrate"),
    deviceName: pick(a, "device_name", "deviceName") || "",
  };
}

const isRun = a => /run/i.test(a.activityType || "");

function normalizeLap(l) {
  const distance = l.distance, moving = l.moving_time;
  return {
    distanceInMeters: distance != null ? Math.round(distance) : null,
    durationInSeconds: moving != null ? Math.round(moving) : null,
    paceSecPerKm: distance > 0 && moving != null ? Math.round(moving / (distance / 1000)) : null,
    averageHeartRateInBeatsPerMinute: l.average_heartrate ?? null,
    averageCadence: l.average_cadence != null ? Math.round(l.average_cadence) : null,
    elevationGainInMeters: l.total_elevation_gain != null ? Math.round(l.total_elevation_gain) : null,
  };
}

function normalizeStreams(raw) {
  const byType = {};
  (Array.isArray(raw) ? raw : []).forEach(s => { byType[s.type] = s.data; });
  const n = (byType.time || []).length;
  if (!n) return null;
  return {
    timeInSeconds: byType.time || [],
    distanceInMeters: byType.distance || [],
    heartrate: byType.heartrate || [],
    altitudeInMeters: byType.altitude || [],
    // pace, not raw speed, is what a runner reads — convert here so the dashboard doesn't have to.
    paceSecPerKm: (byType.velocity_smooth || []).map(v => (v > 0.3 ? Math.round(1000 / v) : null)),
  };
}

async function fetchDetail(apiKey, activityId) {
  const [full, streamsRaw] = await Promise.all([
    call(apiKey, `/activity/${activityId}?intervals=true`),
    call(apiKey, `/activity/${activityId}/streams.json?types=${STREAM_TYPES}`).catch(() => null),
  ]);
  const laps = Array.isArray(full.icu_intervals) ? full.icu_intervals.map(normalizeLap) : [];
  const streams = streamsRaw ? normalizeStreams(streamsRaw) : null;
  return { activityId, laps, streams };
}

async function fetchDetails(activities, keyOf, db) {
  fs.mkdirSync(DETAIL_DIR, { recursive: true });
  const getCached = db.prepare("SELECT lapsJson, streamsJson FROM activity_details WHERE activityId = ?");
  const upsertDetail = db.prepare(`
    INSERT INTO activity_details (activityId, lapsJson, streamsJson, fetchedAt) VALUES (?, ?, ?, ?)
    ON CONFLICT(activityId) DO UPDATE SET lapsJson = excluded.lapsJson, streamsJson = excluded.streamsJson, fetchedAt = excluded.fetchedAt
  `);

  console.log(`\nSyncing ${activities.length} run(s) between disk, DB, and Intervals.icu...`);
  let backfilled = 0, restored = 0, fetched = 0, failed = 0;
  for (const a of activities) {
    const filePath = path.join(DETAIL_DIR, `${a.activityId}.json`);
    const onDisk = fs.existsSync(filePath);
    const cached = getCached.get(String(a.activityId));

    if (onDisk && !cached) {
      // File predates the DB (or DB was deleted) — back the DB up from what's already on disk, no API call.
      const detail = JSON.parse(fs.readFileSync(filePath, "utf8"));
      upsertDetail.run(String(a.activityId), JSON.stringify(detail.laps || []), detail.streams ? JSON.stringify(detail.streams) : null, new Date().toISOString());
      backfilled++;
      continue;
    }
    if (onDisk) continue; // already on disk and already in the DB — nothing to do

    if (cached) {
      // Already in the permanent DB (file cache was probably deleted/cloned fresh) — no need to hit the API again.
      fs.writeFileSync(filePath, JSON.stringify({
        activityId: a.activityId,
        laps: JSON.parse(cached.lapsJson),
        streams: cached.streamsJson ? JSON.parse(cached.streamsJson) : null,
      }));
      restored++;
      continue;
    }
    try {
      const detail = await fetchDetail(keyOf(a.ownerId), a.activityId);
      fs.writeFileSync(filePath, JSON.stringify(detail));
      upsertDetail.run(String(a.activityId), JSON.stringify(detail.laps), detail.streams ? JSON.stringify(detail.streams) : null, new Date().toISOString());
      fetched++;
    } catch (e) {
      console.error(`  ${a.activityId}: detail fetch failed (${e.message})`);
      failed++;
    }
  }
  console.log(`Details: ${fetched} fetched from Intervals.icu, ${restored} restored from local DB, ${backfilled} backfilled into DB from disk, ${failed} failed.`);
}

async function discover(cfg) {
  console.log("--- checking your own account ---");
  let me;
  try {
    me = await call(cfg.apiKey, "/athlete/0/profile");
    const ath = me.athlete || me;
    console.log(`OK. Logged in as: ${ath.name || "(no name)"}   athlete id: ${ath.id}`);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
    console.log(e.body || "");
    console.log("\nIf this is a 401/403 the API key is wrong. Regenerate it at intervals.icu/settings > Developer Settings.");
    return;
  }

  console.log("\n--- who else can this key reach? (the coach question) ---");
  // No documented endpoint for 'athletes I coach'; probe the plausible ones.
  for (const ep of ["/athlete/0/athletes", "/athlete/0/followers", "/athlete/0/following", "/athletes"]) {
    try {
      const r = await call(cfg.apiKey, ep);
      const n = Array.isArray(r) ? r.length : Object.keys(r).length;
      console.log(`  ${ep}  ->  OK (${n} entries)`);
      if (Array.isArray(r) && r.length) console.log("      " + JSON.stringify(r[0]).slice(0, 200));
    } catch (e) {
      console.log(`  ${ep}  ->  ${e.status || e.message}`);
    }
  }

  console.log("\n--- one raw activity, to confirm field names ---");
  const acts = await call(cfg.apiKey, `/athlete/0/activities?oldest=${isoDaysAgo(DAYS_BACK)}&newest=${today()}`);
  console.log(`Found ${acts.length} activities in the last ${DAYS_BACK} days.`);
  if (acts.length) {
    console.log("Field names present on the most recent one:");
    console.log("  " + Object.keys(acts[0]).join(", "));
    console.log("\nNormalized by this script:");
    console.log(JSON.stringify(normalize(acts[0], "me"), null, 2));
  } else {
    console.log("No activities yet — connect Garmin in intervals.icu settings and sync a run, then rerun.");
  }
}

async function fetchAll(cfg) {
  const db = openDb();
  const upsertRunner = db.prepare(`
    INSERT INTO runners (id, name, device) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, device = excluded.device
  `);
  const upsertActivity = db.prepare(`
    INSERT INTO activities (activityId, ownerId, activityName, activityType, startTimeInSeconds,
      distanceInMeters, durationInSeconds, averageHeartRateInBeatsPerMinute, deviceName, fetchedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(activityId) DO UPDATE SET ownerId = excluded.ownerId, activityName = excluded.activityName,
      activityType = excluded.activityType, startTimeInSeconds = excluded.startTimeInSeconds,
      distanceInMeters = excluded.distanceInMeters, durationInSeconds = excluded.durationInSeconds,
      averageHeartRateInBeatsPerMinute = excluded.averageHeartRateInBeatsPerMinute,
      deviceName = excluded.deviceName, fetchedAt = excluded.fetchedAt
  `);

  const athletes = cfg.athletes && cfg.athletes.length ? cfg.athletes : [{ id: "0", name: "אני" }];
  const oldest = isoDaysAgo(DAYS_BACK), newest = today();
  const runners = [], activities = [];
  const keyByAthlete = {}; // needed again in fetchDetails, since laps/streams are per-activity calls
  const fetchedAt = new Date().toISOString();

  for (let i = 0; i < athletes.length; i++) {
    const ath = athletes[i];
    const key = ath.apiKey || cfg.apiKey; // an athlete may supply their own key
    keyByAthlete[ath.id] = key;
    try {
      const raw = await call(key, `/athlete/${ath.id}/activities?oldest=${oldest}&newest=${newest}`);
      const mine = raw.map(a => normalize(a, ath.id)).filter(isRun)
        .filter(a => a.distanceInMeters && a.durationInSeconds);
      activities.push(...mine);
      const device = mine.find(a => a.deviceName)?.deviceName || "";
      runners.push({ id: ath.id, name: ath.name || ath.id, device, slot: (i % 8) + 1 });
      upsertRunner.run(String(ath.id), ath.name || String(ath.id), device);
      for (const a of mine) {
        upsertActivity.run(String(a.activityId), String(a.ownerId), a.activityName, a.activityType,
          a.startTimeInSeconds, a.distanceInMeters, a.durationInSeconds,
          a.averageHeartRateInBeatsPerMinute, a.deviceName, fetchedAt);
      }
      console.log(`${ath.name || ath.id}: ${mine.length} runs`);
    } catch (e) {
      console.error(`${ath.name || ath.id}: FAILED (${e.message}) ${e.body || ""}`);
    }
  }

  if (!activities.length) {
    console.error("\nNo activities fetched — data.json not written (the dashboard keeps its demo data).");
    db.close();
    process.exit(1);
  }

  activities.sort((a, b) => b.startTimeInSeconds - a.startTimeInSeconds);
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "intervals.icu",
    runners, activities,
  }, null, 2));
  console.log(`\nWrote ${activities.length} runs from ${runners.length} runners -> data.json`);

  await fetchDetails(activities, ownerId => keyByAthlete[ownerId], db);
  db.close();
  console.log("Refresh the dashboard to see them.");
}

(async () => {
  const cfg = loadConfig();
  try {
    if (process.argv[2] === "discover") await discover(cfg);
    else await fetchAll(cfg);
  } catch (e) {
    console.error("Error:", e.message);
    if (e.body) console.error(e.body);
    process.exit(1);
  }
})();

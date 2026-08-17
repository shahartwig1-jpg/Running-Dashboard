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
const supa = require("./supabase");

const BASE = "https://intervals.icu/api/v1";
const CONFIG_PATH = path.join(__dirname, "config.json");
const KEY_PATH = path.join(__dirname, "key.txt"); // holds only the key, so there is no syntax to break
const OUT_PATH = path.join(__dirname, "data.json");
const DAYS_BACK = 70; // ~10 weeks, enough for the 8-week trend plus slack
const DETAIL_DIR = path.join(__dirname, "details"); // per-activity laps + streams, one file each
const STREAM_TYPES = "time,heartrate,distance,altitude,velocity_smooth";
const PLAN_PATH = path.join(__dirname, "plan.csv"); // local fallback, used only if no PLAN_CSV_URL is configured
const PLAN_WEEKDAY_COLUMNS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]; // index = Date#getDay()

// Minimal RFC4180-ish CSV parser (no dependency): a field only enters quoted mode if the
// `"` is the very first character of that field, so a literal quote elsewhere in an
// unquoted field (e.g. the גרשיים in "ק"מ") is just a character, not a parse error.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false, fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
      continue;
    }
    if (fieldStart && c === '"') { inQuotes = true; fieldStart = false; continue; }
    if (c === ",") { row.push(field); field = ""; fieldStart = true; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; fieldStart = true; continue; }
    field += c; fieldStart = false;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ""));
}

// Weekly plan, keyed by athlete id -> array of 7 day strings (Sun -> Sat), same
// indexing the dashboard already uses for the "ק״מ לפי יום בשבוע" chart.
// Source is the published Google Sheet CSV (planCsvUrl / PLAN_CSV_URL) if configured,
// so the group can edit next week's plan without a code change; plan.csv is only the
// local fallback for whoever has no URL configured yet.
async function loadPlan(athletes, csvUrl) {
  let text;
  if (csvUrl) {
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      console.error(`Failed to fetch plan from PLAN_CSV_URL (${e.message})` +
        (fs.existsSync(PLAN_PATH) ? " — falling back to local plan.csv." : " — no local plan.csv to fall back to."));
    }
  }
  if (text === undefined) {
    if (!fs.existsSync(PLAN_PATH)) return null;
    text = fs.readFileSync(PLAN_PATH, "utf8");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM Google Sheets sometimes adds
  const rows = parseCsv(text);
  if (!rows.length) return null;
  // The published Sheet CSV can have leading blank rows/columns depending on exactly
  // where the paste landed, so find the header row by content instead of assuming it's
  // rows[0] — same reason the name column below is found relative to the day columns
  // instead of assumed to be column 0.
  const headerIdx = rows.findIndex(row => PLAN_WEEKDAY_COLUMNS.every(label => row.includes(label)));
  if (headerIdx === -1) {
    console.error(`plan: header must include all of ${PLAN_WEEKDAY_COLUMNS.join(", ")} — plan not loaded.`);
    return null;
  }
  const header = rows[headerIdx];
  const dayCols = PLAN_WEEKDAY_COLUMNS.map(label => header.indexOf(label));
  const nameCol = Math.max(Math.min(...dayCols) - 1, 0); // the name column sits immediately left of the first day column
  const plan = {};
  for (const row of rows.slice(headerIdx + 1)) {
    const label = (row[nameCol] || "").trim();
    if (!label) continue;
    const athlete = athletes.find(a => (a.planName || a.name || "").trim() === label);
    if (!athlete) {
      console.error(`plan: no runner matches "${label}" (checked planName/name in config.json) — row skipped.`);
      continue;
    }
    plan[athlete.id] = dayCols.map(i => (row[i] || "").trim());
  }
  return plan;
}

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
  // Published Google Sheet CSV URL for the live/editable weekly plan (env wins, same
  // pattern as apiKey above — CI supplies it as a secret, config.json for local runs).
  if (process.env.PLAN_CSV_URL) cfg.planCsvUrl = process.env.PLAN_CSV_URL;
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
const thisWeekStart = () => { // this week's Sunday, as YYYY-MM-DD — same convention index.html uses
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
};

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

/* Intervals.icu's wellness record carries a lot more than sleep (mood, stress,
   bodyFat, bloodGlucose, menstrualPhase, ...). Teammates agreed to share running
   data, not that — so only these four fields are ever read off the response. */
async function fetchWellness(apiKey, athleteId, oldest, newest) {
  const raw = await call(apiKey, `/athlete/${athleteId}/wellness?oldest=${oldest}&newest=${newest}`);
  return raw
    .filter(r => r.sleepSecs != null || r.sleepScore != null || r.sleepQuality != null || r.avgSleepingHR != null)
    .map(r => ({
      date: r.id,
      sleepSecs: r.sleepSecs ?? null,
      sleepScore: r.sleepScore ?? null,
      sleepQuality: r.sleepQuality ?? null,
      avgSleepingHR: r.avgSleepingHR ?? null,
    }));
}

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

async function fetchDetails(activities, keyOf) {
  fs.mkdirSync(DETAIL_DIR, { recursive: true });
  const missing = activities.filter(a => !fs.existsSync(path.join(DETAIL_DIR, `${a.activityId}.json`)));
  console.log(`\n${missing.length} run(s) missing their detail file (${activities.length - missing.length} already on disk)...`);

  let restored = 0, fetched = 0, failed = 0;
  for (const a of missing) {
    const filePath = path.join(DETAIL_DIR, `${a.activityId}.json`);
    const cached = await supa.getActivityDetail(String(a.activityId));
    if (cached) {
      // Already in Supabase (file cache was probably deleted/cloned fresh) — no need to hit the API again.
      fs.writeFileSync(filePath, JSON.stringify({ activityId: a.activityId, laps: cached.laps || [], streams: cached.streams || null }));
      restored++;
      continue;
    }
    try {
      const detail = await fetchDetail(keyOf(a.ownerId), a.activityId);
      fs.writeFileSync(filePath, JSON.stringify(detail));
      await supa.upsertActivityDetail(String(a.activityId), detail.laps, detail.streams, new Date().toISOString());
      fetched++;
    } catch (e) {
      console.error(`  ${a.activityId}: detail fetch failed (${e.message})`);
      failed++;
    }
  }
  console.log(`Details: ${fetched} fetched from Intervals.icu, ${restored} restored from Supabase, ${failed} failed.`);
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
  const athletes = cfg.athletes && cfg.athletes.length ? cfg.athletes : [{ id: "0", name: "אני" }];
  const oldest = isoDaysAgo(DAYS_BACK), newest = today();
  const runners = [], activities = [], sleep = [];
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
      console.log(`${ath.name || ath.id}: ${mine.length} runs`);

      try {
        const nights = await fetchWellness(key, ath.id, oldest, newest);
        for (const n of nights) sleep.push({ ownerId: ath.id, ...n });
        console.log(`${ath.name || ath.id}: ${nights.length} night(s) of sleep data`);
      } catch (e) {
        console.error(`${ath.name || ath.id}: sleep fetch failed (${e.message})`);
      }
    } catch (e) {
      console.error(`${ath.name || ath.id}: FAILED (${e.message}) ${e.body || ""}`);
    }
  }

  if (!activities.length) {
    console.error("\nNo activities fetched — data.json not written (the dashboard keeps its demo data).");
    process.exit(1);
  }

  await supa.upsertRunners(runners.map(r => ({ id: String(r.id), name: r.name, device: r.device })));
  await supa.upsertActivities(activities.map(a => ({
    activityId: String(a.activityId), ownerId: String(a.ownerId), activityName: a.activityName,
    activityType: a.activityType, startTimeInSeconds: a.startTimeInSeconds, distanceInMeters: a.distanceInMeters,
    durationInSeconds: a.durationInSeconds, averageHeartRateInBeatsPerMinute: a.averageHeartRateInBeatsPerMinute,
    deviceName: a.deviceName, fetchedAt,
  })));
  if (sleep.length) {
    await supa.upsertSleep(sleep.map(s => ({
      ownerId: String(s.ownerId), date: s.date, sleepSecs: s.sleepSecs, sleepScore: s.sleepScore,
      sleepQuality: s.sleepQuality, avgSleepingHR: s.avgSleepingHR, fetchedAt,
    })));
  }

  activities.sort((a, b) => b.startTimeInSeconds - a.startTimeInSeconds);
  const plan = await loadPlan(athletes, cfg.planCsvUrl);
  if (plan) {
    const weekStartStr = thisWeekStart();
    const rows = [];
    for (const [ownerId, days] of Object.entries(plan)) {
      days.forEach((text, weekday) => rows.push({ ownerId: String(ownerId), weekStart: weekStartStr, weekday, text, fetchedAt }));
    }
    await supa.upsertPlanDays(rows);
  }
  // Full plan history (every week ever seen, not just this one) so the dashboard can page back.
  const planHistoryRows = await supa.getPlanHistory();
  const planHistory = {};
  for (const row of planHistoryRows) {
    planHistory[row.ownerId] ??= {};
    planHistory[row.ownerId][row.weekStart] ??= new Array(7).fill(null);
    planHistory[row.ownerId][row.weekStart][row.weekday] = row.text;
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "intervals.icu",
    runners, activities, sleep, planHistory,
  }, null, 2));
  console.log(`\nWrote ${activities.length} runs from ${runners.length} runners -> data.json` +
    ` (+ ${sleep.length} night(s) of sleep data${plan ? `, plan for ${Object.keys(plan).length} runner(s)` : ", no plan loaded"}, ${planHistoryRows.length} plan-history row(s) total)`);

  await fetchDetails(activities, ownerId => keyByAthlete[ownerId]);
  console.log("Refresh the dashboard to see them.");
}

// Only auto-run as a script (`node fetch-data.js`) — not when required by tests.
if (require.main === module) {
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
}

module.exports = { normalize, normalizeLap, normalizeStreams, parseCsv };

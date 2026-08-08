// Talks to Supabase's auto-generated REST API (PostgREST) with plain fetch() — no client
// library, keeping the project's zero-npm-dependency rule. Field names match the old
// dashboard.db (SQLite) columns exactly, so callers didn't need to change.
const fs = require("fs");
const path = require("path");

const URL_PATH = path.join(__dirname, "supabase-url.txt");
const KEY_PATH = path.join(__dirname, "supabase-key.txt"); // the service_role key — never commit

function loadCreds() {
  const url = process.env.SUPABASE_URL || (fs.existsSync(URL_PATH) ? fs.readFileSync(URL_PATH, "utf8").trim() : "");
  const key = process.env.SUPABASE_SERVICE_KEY || (fs.existsSync(KEY_PATH) ? fs.readFileSync(KEY_PATH, "utf8").trim() : "");
  if (!url || !key) {
    console.error("Missing Supabase credentials.");
    console.error("Paste your Project URL into supabase-url.txt and your service_role key into supabase-key.txt");
    console.error("(Supabase dashboard -> Project Settings -> API).");
    process.exit(1);
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function request(method, table, { query = "", body, prefer } = {}) {
  const { url, key } = loadCreds();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Supabase ${method} ${table} -> HTTP ${res.status}`);
    err.status = res.status;
    err.body = text.slice(0, 500);
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// Upsert one or many rows. `onConflict` must match a primary key / unique constraint.
async function upsert(table, rows, onConflict) {
  if (!rows.length) return;
  await request("POST", table, {
    query: `?on_conflict=${onConflict}`,
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function upsertRunners(rows) { return upsert("runners", rows, "id"); }
async function upsertActivities(rows) { return upsert("activities", rows, "activityId"); }
async function upsertSleep(rows) { return upsert("sleep", rows, "ownerId,date"); }
async function upsertPlanDays(rows) { return upsert("plan_history", rows, "ownerId,weekStart,weekday"); }

async function upsertActivityDetail(activityId, laps, streams, fetchedAt) {
  return upsert("activity_details", [{ activityId, laps, streams, fetchedAt }], "activityId");
}

// Returns { laps, streams } (already-parsed objects — jsonb, not a string) or null.
async function getActivityDetail(activityId) {
  const rows = await request("GET", "activity_details", {
    query: `?activityId=eq.${encodeURIComponent(activityId)}&select=laps,streams`,
  });
  return rows && rows.length ? rows[0] : null;
}

async function getPlanHistory() {
  return request("GET", "plan_history", {
    query: `?select=ownerId,weekStart,weekday,text&order=ownerId,weekStart,weekday`,
  });
}

module.exports = {
  upsertRunners, upsertActivities, upsertSleep, upsertPlanDays,
  upsertActivityDetail, getActivityDetail, getPlanHistory,
};

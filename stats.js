// Profile numbers per runner (supabase/runner_stats.sql): the latest wellness values (weight, resting HR, HRV,
// VO2max, fitness/fatigue) plus the athlete's own Intervals.icu settings (weight, max HR, threshold HR and pace).
// fetch-data.js hands the raw data in during the sync and calls saveStats() at the end; every step is wrapped
// there in try/catch, so a refused call or a missing table never stops the rest of the sync.
const { rest } = require("./records");

const byRunner = {}; // ownerId -> { wellness: [...], athlete: {...} }
const slot = id => (byRunner[String(id)] ??= { wellness: [], athlete: null });

function noteWellness(ownerId, raw) { slot(ownerId).wellness.push(...raw); }
function noteAthlete(ownerId, athlete) { slot(ownerId).athlete = athlete; }

const num = v => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);
// The newest day that has a value for this field (wellness rows are one per date, "id" = YYYY-MM-DD).
const latest = (rows, field) => {
  let best = null;
  for (const r of rows) if (num(r[field]) != null && (!best || r.id > best.id)) best = r;
  return best ? best[field] : null;
};

function buildRows() {
  const fitness = [], body = [], updatedAt = new Date().toISOString();
  for (const [ownerId, { wellness, athlete }] of Object.entries(byRunner)) {
    const run = (athlete?.sportSettings || []).find(s => (s.types || []).includes("Run")) || {};
    const row = {
      ownerId,
      vo2max: round1(latest(wellness, "vo2max")),
      restingHR: num(latest(wellness, "restingHR")) ?? num(athlete?.icu_resting_hr),
      hrv: round1(latest(wellness, "hrv")),
      maxHR: num(run.max_hr),
      lthr: num(run.lthr),
      thresholdPace: num(run.threshold_pace) ? Math.round(1000 / run.threshold_pace) : null, // m/s -> sec/km
      fitness: round1(latest(wellness, "ctl")),
      fatigue: round1(latest(wellness, "atl")),
      updatedAt,
    };
    if (Object.entries(row).some(([k, v]) => k !== "ownerId" && k !== "updatedAt" && v != null)) fitness.push(row);
    // Only send weight when Intervals.icu has one, so a weight typed in on the profile isn't wiped by an empty sync.
    const weightKg = round1(num(latest(wellness, "weight")) ?? num(athlete?.icu_weight));
    if (weightKg) body.push({ ownerId, weightKg, updatedAt });
  }
  return { fitness, body };
}

async function saveStats() {
  const { fitness, body } = buildRows();
  const prefer = "resolution=merge-duplicates,return=minimal";
  if (fitness.length) await rest("POST", "runner_fitness?on_conflict=ownerId", { body: fitness, prefer });
  if (body.length) await rest("POST", "runner_body?on_conflict=ownerId", { body, prefer });
  console.log(`Profile stats: fitness for ${fitness.length} runner(s), weight for ${body.length}`);
}

module.exports = { noteWellness, noteAthlete, saveStats, buildRows };

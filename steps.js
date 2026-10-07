// Saves daily step counts (supabase/daily_steps.sql). Called by fetch-data.js after the sync; a failure here
// (for example the table not existing yet) is caught there and never stops the rest of the sync.
const { rest } = require("./records");

async function saveSteps(rows) {
  const fetchedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) { // one request per 500 rows
    await rest("POST", "daily_steps?on_conflict=ownerId,date", {
      body: rows.slice(i, i + 500).map(r => ({ ...r, fetchedAt })),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
  console.log(`Steps: ${rows.length} day(s) saved across ${new Set(rows.map(r => r.ownerId)).size} runner(s)`);
}

module.exports = { saveSteps };

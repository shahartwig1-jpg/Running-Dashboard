// Run with: node --test   (and with TZ=UTC / TZ=America/New_York to check the phone's time zone doesn't matter)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const D = require("../plan-dates");

// The key the page used to compute on a phone in Israel: local Sunday midnight -> toISOString date.
function legacyKeyInIsrael(sundayYMD) {
  // Israel is UTC+2 (winter) or UTC+3 (summer): local midnight is 21:00 or 22:00 UTC on the Saturday.
  const [y, m, d] = sundayYMD.split("-").map(Number);
  const sundayMidnightIsrael = new Date(Date.UTC(y, m - 1, d) - 2 * 3600 * 1000); // either offset lands on Saturday
  return sundayMidnightIsrael.toISOString().slice(0, 10);
}

test("planWeekKey matches the stored format (the Saturday before the Sunday)", () => {
  assert.equal(D.planWeekKey("2026-08-02"), "2026-08-01");
  assert.equal(D.planWeekKey("2026-11-15"), "2026-11-14");
  assert.equal(D.planWeekKey("2027-01-03"), "2027-01-02"); // across the new year
  for (const s of ["2026-03-22", "2026-03-29", "2026-10-18", "2026-10-25", "2026-11-01"]) assert.equal(D.planWeekKey(s), legacyKeyInIsrael(s));
});

test("weeks around both daylight-saving changes stay 7 calendar days apart", () => {
  // Israel 2026: summer time starts Fri 27 Mar, ends Sun 25 Oct.
  assert.equal(D.addDays("2026-03-22", 7), "2026-03-29");
  assert.equal(D.addDays("2026-10-18", 7), "2026-10-25");
  assert.equal(D.addDays("2026-10-25", 7), "2026-11-01");
  assert.equal(D.addDays("2026-11-01", -35), "2026-09-27");
  assert.equal(D.weekdayOf("2026-10-25"), 0);
  assert.equal(D.sundayOf("2026-10-31"), "2026-10-25");
  assert.equal(D.sundayOf("2026-10-25"), "2026-10-25");
});

test("israelYMD uses Israel's calendar day, not UTC's", () => {
  assert.equal(D.israelYMD(new Date("2026-11-20T21:30:00Z")), "2026-11-20"); // 23:30 in Israel
  assert.equal(D.israelYMD(new Date("2026-11-20T22:30:00Z")), "2026-11-21"); // 00:30 the next day in Israel
  assert.equal(D.israelYMD(new Date("2026-07-15T21:30:00Z")), "2026-07-16"); // summer time: already 00:30
  assert.equal(D.israelYMD(Date.parse("2026-07-15T20:30:00Z")), "2026-07-15");
});

test("same results whatever time zone the device is set to", () => {
  const script = `const D=require(${JSON.stringify(path.join(__dirname, "..", "plan-dates.js"))});
    console.log(JSON.stringify([D.israelYMD(new Date("2026-11-20T22:30:00Z")), D.planWeekKey(D.sundayOf(D.israelYMD(new Date("2026-11-20T22:30:00Z")))), D.addDays("2026-10-18", 7), D.labelDate("2026-10-25").getDate()]))`;
  const results = ["Asia/Jerusalem", "UTC", "America/New_York", "Pacific/Auckland"].map(tz =>
    execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: tz } }).toString().trim());
  // Sat 21 Nov is in the week of Sun 15 Nov, so its key is Sat 14 Nov.
  for (const r of results) assert.equal(r, JSON.stringify(["2026-11-21", "2026-11-14", "2026-10-25", 25]));
});

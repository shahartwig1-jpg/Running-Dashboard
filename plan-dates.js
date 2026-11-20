// Calendar dates for the training plan and the weekly mileage chart, always in Israel time
// (the group's time zone), whatever time zone the phone is set to.
//
// Days are "YYYY-MM-DD" strings and all arithmetic is on calendar days (never 7 * 24 h), so
// daylight-saving changes can't shift a week by a day.
//
// planWeekKey() must keep matching the keys already stored in plan_history: the page used to
// save weeks as weekStart(localSunday).toISOString().slice(0, 10), and Israel is ahead of UTC,
// so every stored key is the SATURDAY before the week's Sunday. Keep that until the rows are migrated.
(function (root) {
  "use strict";
  const TZ = "Asia/Jerusalem";
  let fmt = null;
  try { fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }); } catch (e) { fmt = null; }

  const pad = n => String(n).padStart(2, "0");
  const parts = ymd => ymd.split("-").map(Number);
  const utcNoon = ymd => { const [y, m, d] = parts(ymd); return new Date(Date.UTC(y, m - 1, d, 12)); };

  // The calendar day in Israel at a moment in time (a Date, or epoch milliseconds).
  function israelYMD(when) {
    const d = when instanceof Date ? when : new Date(when);
    if (fmt) {
      const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}`;
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // no Intl time zones: fall back to the device's own day
  }
  function addDays(ymd, n) {
    const d = utcNoon(ymd);
    d.setUTCDate(d.getUTCDate() + n);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const weekdayOf = ymd => utcNoon(ymd).getUTCDay(); // 0 = Sunday
  const sundayOf = ymd => addDays(ymd, -weekdayOf(ymd));
  const planWeekKey = sundayYMD => addDays(sundayYMD, -1);
  // A Date at local noon on that calendar day, only for formatting labels (noon stays on the same day in any zone the group uses).
  const labelDate = ymd => { const [y, m, d] = parts(ymd); return new Date(y, m - 1, d, 12); };

  // The calendar day an activity happened on, from its stored startTimeInSeconds.
  // fetch-data.js parses Intervals.icu's start_date_local (the watch's wall-clock time, no offset) on GitHub Actions,
  // which runs in UTC, so the stored value is the LOCAL time written as if it were UTC: Saturday 22:30 in Israel is
  // stored as Saturday 22:30Z. Its UTC date is therefore the runner's own local date; converting it to Israel time
  // would wrongly move late-evening runs into the next day (and Saturday-night runs into the next week).
  // Fallback: an activity with no start_date_local is stored from start_date (real UTC), so its day is the UTC date,
  // which is a day early only for runs between midnight and 02:00/03:00 Israel time. Running fetch-data.js on a
  // computer set to Israel time (not CI) stores real UTC instead; production data comes from CI.
  const activityYMD = startTimeInSeconds => new Date(startTimeInSeconds * 1000).toISOString().slice(0, 10);

  const api = { TZ, israelYMD, addDays, weekdayOf, sundayOf, planWeekKey, labelDate, activityYMD };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlanDates = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

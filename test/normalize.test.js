const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalize } = require("../fetch-data");

test("normalize: reads primary field names", () => {
  const a = normalize({
    id: "i1", name: "Morning Run", type: "Run",
    start_date_local: "2026-08-01T06:00:00", distance: 10000, moving_time: 3000,
    average_heartrate: 145, device_name: "Garmin fenix 7",
  }, "u1");
  assert.equal(a.activityId, "i1");
  assert.equal(a.ownerId, "u1");
  assert.equal(a.activityName, "Morning Run");
  assert.equal(a.distanceInMeters, 10000);
  assert.equal(a.durationInSeconds, 3000);
  assert.equal(a.averageHeartRateInBeatsPerMinute, 145);
  assert.equal(a.deviceName, "Garmin fenix 7");
});

test("normalize: falls back to icu_-prefixed fields when primary ones are missing", () => {
  const a = normalize({
    id: "i2", start_date: "2026-08-01T06:00:00",
    icu_distance: 5000, icu_moving_time: 1500, icu_average_heartrate: 130,
  }, "u1");
  assert.equal(a.distanceInMeters, 5000);
  assert.equal(a.durationInSeconds, 1500);
  assert.equal(a.averageHeartRateInBeatsPerMinute, 130);
});

test("normalize: falls back to elapsed_time when moving_time is entirely absent", () => {
  const a = normalize({
    id: "i3", start_date: "2026-08-01T06:00:00", distance: 8000, elapsed_time: 2400,
  }, "u1");
  assert.equal(a.durationInSeconds, 2400);
});

test("normalize: missing distance/duration degrade to null instead of throwing", () => {
  const a = normalize({ id: "i4", start_date: "2026-08-01T06:00:00" }, "u1");
  assert.equal(a.distanceInMeters, null);
  assert.equal(a.durationInSeconds, null);
});

test("normalize: missing name/type/device fall back to sane defaults", () => {
  const a = normalize({ id: "i5", start_date: "2026-08-01T06:00:00" }, "u1");
  assert.equal(a.activityName, "ריצה");
  assert.equal(a.activityType, "Run");
  assert.equal(a.deviceName, "");
});

test("normalize: sport field is used when type is absent", () => {
  const a = normalize({ id: "i6", start_date: "2026-08-01T06:00:00", sport: "Trail Run" }, "u1");
  assert.equal(a.activityType, "Trail Run");
});

// Pace must come from the time spent moving, not the watch's timer time (which includes standing at lights):
// the 2026-10-12 25 km run showed 4:19 on the dashboard while Garmin said 4:15. "Time" stays the timer time.
test("normalize: keeps moving time apart from timer time, so pace is moving pace", () => {
  const a = normalize({
    id: "i196326107", type: "Run", start_date_local: "2026-10-12T09:32:22",
    distance: 24997, icu_recording_time: 6462, moving_time: 6384,
  }, "u1");
  assert.equal(a.durationInSeconds, 6462); // shown as "Time"
  assert.equal(a.movingSeconds, 6384);     // every pace is worked out from this
  const pace = a.movingSeconds / (a.distanceInMeters / 1000);
  assert.equal(`${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, "0")}`, "4:15");
});

test("normalize: no moving time from Intervals leaves movingSeconds empty (the page then falls back to timer time)", () => {
  const a = normalize({ id: "i9", type: "Run", start_date_local: "2026-10-12T09:32:22", distance: 5000, elapsed_time: 1600 }, "u1");
  assert.equal(a.movingSeconds, null);
});

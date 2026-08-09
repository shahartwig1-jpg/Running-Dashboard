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

-- Run this once in the Supabase SQL Editor (left sidebar -> SQL Editor -> New query -> paste -> Run).
-- Mirrors dashboard.db (SQLite) exactly, so fetch-data.js needs no field-name changes —
-- only the transport (local SQLite calls -> Supabase REST calls) changes.
-- Column names are quoted to keep camelCase (matching the rest of the codebase) instead
-- of Postgres's default snake_case.

create table if not exists runners (
  id text primary key,
  name text,
  device text
);

create table if not exists activities (
  "activityId" text primary key,
  "ownerId" text not null,
  "activityName" text,
  "activityType" text,
  "startTimeInSeconds" bigint not null,
  "distanceInMeters" integer,
  "durationInSeconds" integer,
  "averageHeartRateInBeatsPerMinute" integer,
  "deviceName" text,
  "fetchedAt" timestamptz not null
);

create table if not exists activity_details (
  "activityId" text primary key,
  laps jsonb,
  streams jsonb,
  "fetchedAt" timestamptz not null
);

-- Deliberately narrow, same as the SQLite version: Intervals.icu's wellness record also
-- carries mood, stress, bodyFat, bloodGlucose, menstrualPhase, etc. Only sleep fields are
-- ever written here.
create table if not exists sleep (
  "ownerId" text not null,
  date date not null,
  "sleepSecs" integer,
  "sleepScore" real,
  "sleepQuality" integer,
  "avgSleepingHR" integer,
  "fetchedAt" timestamptz not null,
  primary key ("ownerId", date)
);

-- The live/editable plan (Google Sheet, eventually) only ever holds "this week". This
-- table is what actually remembers past weeks, snapshotted on every fetch-data.js run.
create table if not exists plan_history (
  "ownerId" text not null,
  "weekStart" date not null,
  weekday integer not null,
  text text,
  "fetchedAt" timestamptz not null,
  primary key ("ownerId", "weekStart", weekday)
);

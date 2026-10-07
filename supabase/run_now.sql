-- RUN THIS ONCE in the Supabase SQL Editor (2026-10-07). Safe to run again: every step checks first.
-- Part 1: profile numbers (same as runner_stats.sql). Part 2: the hidden column (same as hide_missing_activities.sql).

-- ===== Part 1: profile numbers =====
--
-- Extra numbers on each runner's profile page, in two tables because they have different readers:
--   * runner_fitness: everything that comes from Intervals.icu, which the whole group can see (weight, VO2max,
--     resting HR, HRV, max HR, threshold HR and pace, fitness/fatigue). Filled only by fetch-data.js (via stats.js)
--     with the service_role key.
--   * runner_body: birth year and height, which Intervals.icu doesn't have. Typed in on the profile page by the
--     runner or a coach, and only they can see them.

create table if not exists runner_fitness (
  "ownerId" text primary key references runners(id) on delete cascade,
  "weightKg" numeric,
  vo2max numeric,
  "restingHR" integer,
  hrv numeric,
  "maxHR" integer,
  lthr integer,
  "thresholdPace" integer,   -- seconds per km
  fitness numeric,           -- Intervals.icu CTL
  fatigue numeric,           -- Intervals.icu ATL
  "updatedAt" timestamptz not null default now()
);

create table if not exists runner_body (
  "ownerId" text primary key references runners(id) on delete cascade,
  "birthYear" integer check ("birthYear" between 1920 and 2020),
  "heightCm" integer check ("heightCm" between 100 and 230),
  "updatedAt" timestamptz not null default now()
);

alter table runner_fitness enable row level security;
alter table runner_body enable row level security;

-- Required for new tables from Oct 30 (Supabase stopped granting API access automatically). No `anon`: login required.
grant select on public.runner_fitness to authenticated;
grant select, insert, update, delete on public.runner_fitness to service_role;
grant select, insert, update on public.runner_body to authenticated;
grant select, insert, update, delete on public.runner_body to service_role;

drop policy if exists "authenticated can read runner_fitness" on runner_fitness;
create policy "authenticated can read runner_fitness" on runner_fitness
  for select to authenticated using (true);

-- Same rule as the profile photo: your own row, or any row if you are a coach.
drop policy if exists "own body or coach: read" on runner_body;
create policy "own body or coach: read" on runner_body
  for select to authenticated using (public.can_edit_profile("ownerId"));

drop policy if exists "own body or coach: add" on runner_body;
create policy "own body or coach: add" on runner_body
  for insert to authenticated with check (public.can_edit_profile("ownerId"));

drop policy if exists "own body or coach: update" on runner_body;
create policy "own body or coach: update" on runner_body
  for update to authenticated
  using (public.can_edit_profile("ownerId"))
  with check (public.can_edit_profile("ownerId"));

-- ===== Part 2: hide runs that drop out of the Intervals.icu list without a confirmed delete =====
-- Supports auto-hiding runs that vanish from Intervals.icu's activity list without
-- returning a real 404 on direct lookup (confirmed real, undocumented platform quirk —
-- not something fetch-data.js can tell apart from an actual deletion). A confirmed 404
-- still triggers a real delete; this column is for the "can't be sure" case, so the run
-- disappears from the dashboard automatically either way, but nothing is destroyed if it
-- turns out to just be a temporary listing quirk.

alter table activities add column if not exists hidden boolean not null default false;

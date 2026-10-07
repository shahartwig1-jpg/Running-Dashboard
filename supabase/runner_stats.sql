-- Run this once in the Supabase SQL Editor (after profiles.sql, which created can_edit_profile()).
--
-- Extra numbers on each runner's profile page, in two tables because they have different readers:
--   * runner_fitness: running numbers the whole group can see (VO2max, resting HR, max HR, threshold HR and pace,
--     fitness/fatigue). Filled only by fetch-data.js (via stats.js) with the service_role key.
--   * runner_body: personal numbers (birth year, height, weight) that only the runner themself and the coaches
--     can see. Weight comes from Intervals.icu when it has one; birth year and height (Intervals.icu has neither)
--     are typed in on the profile page by the runner or a coach.

create table if not exists runner_fitness (
  "ownerId" text primary key references runners(id) on delete cascade,
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
  "weightKg" numeric check ("weightKg" between 25 and 250),
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

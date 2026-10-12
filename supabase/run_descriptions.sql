-- Run this once in the Supabase SQL Editor (after profiles.sql, which created can_edit_profile()). Safe to run again.
--
-- Part 1: moving time. The dashboard's pace used the watch's timer time, which includes standing at lights, so
-- a 4:15 run showed as 4:19. fetch-data.js now also saves the moving time and every pace is worked out from it;
-- "Time" stays the timer time. Older runs without it fall back to the timer time.
alter table activities add column if not exists "movingSeconds" integer;

-- Part 2: run descriptions. A few words the runner writes about their run, shown on its card in the feed.
-- Everyone logged in can read them; only the run's owner (or a coach) can write one. The owner is looked up from
-- the activities table, never taken from what the browser sends.
create table if not exists run_notes (
  "activityId" text primary key references activities("activityId") on delete cascade,
  text text not null default '' check (char_length(text) <= 1000),
  "updatedAt" timestamptz not null default now()
);

alter table run_notes enable row level security;

-- Required for new tables from Oct 30 (Supabase stopped granting API access automatically). No `anon`: login required.
grant select, insert, update, delete on public.run_notes to authenticated;
grant select, insert, update, delete on public.run_notes to service_role;

drop policy if exists "authenticated can read run notes" on run_notes;
create policy "authenticated can read run notes" on run_notes
  for select to authenticated using (true);

drop policy if exists "run owner or coach: add note" on run_notes;
create policy "run owner or coach: add note" on run_notes
  for insert to authenticated
  with check (public.can_edit_profile((select "ownerId" from activities a where a."activityId" = run_notes."activityId")));

drop policy if exists "run owner or coach: change note" on run_notes;
create policy "run owner or coach: change note" on run_notes
  for update to authenticated
  using (public.can_edit_profile((select "ownerId" from activities a where a."activityId" = run_notes."activityId")))
  with check (public.can_edit_profile((select "ownerId" from activities a where a."activityId" = run_notes."activityId")));

drop policy if exists "run owner or coach: remove note" on run_notes;
create policy "run owner or coach: remove note" on run_notes
  for delete to authenticated
  using (public.can_edit_profile((select "ownerId" from activities a where a."activityId" = run_notes."activityId")));

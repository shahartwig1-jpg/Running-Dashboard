-- Run this once in the Supabase SQL Editor.
--
-- One row per runner per day with the step count Garmin reports, for the "Daily steps" graph on the home page.
-- Filled by fetch-data.js (via steps.js) with the service_role key; the dashboard only reads it, so there is
-- deliberately no insert/update/delete policy for logged-in users. Runners whose Garmin wellness data does not
-- reach Intervals.icu simply have no rows and are left out of the graph.

create table if not exists daily_steps (
  "ownerId" text not null,
  date date not null,
  steps integer not null,
  "fetchedAt" timestamptz not null default now(),
  primary key ("ownerId", date)
);

alter table daily_steps enable row level security;

-- Required for new tables from Oct 30 (Supabase stopped granting API access automatically).
-- No grant to `anon` on purpose: the app requires login.
grant select on public.daily_steps to authenticated;
grant select, insert, update, delete on public.daily_steps to service_role;

drop policy if exists "authenticated can read daily_steps" on daily_steps;
create policy "authenticated can read daily_steps" on daily_steps
  for select to authenticated using (true);

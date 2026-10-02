-- Run this once in the Supabase SQL Editor.
--
-- Saved personal records. One row per run that BEAT that runner's previous best at a
-- distance (so the table is the runner's whole progression, and "this run was a new record"
-- stays true forever, even after someone beats it later). `previousSeconds` is the best before
-- this run -- null for the first logged run at that distance. Today only distance '10k' exists;
-- adding 5k / half marathon later is one more entry in records.js, no schema change.
--
-- Filled by records.js, which fetch-data.js runs after every sync (service_role key). The
-- dashboard only reads it, so there is deliberately no insert/update/delete policy for
-- authenticated users.

create table if not exists records (
  "ownerId" text not null,
  distance text not null,
  seconds integer not null,
  "activityId" text not null,
  "startTimeInSeconds" bigint not null,
  "previousSeconds" integer,
  primary key ("ownerId", distance, "activityId")
);

alter table records enable row level security;

-- Required for new tables from Oct 30 (Supabase stopped granting API access automatically).
-- No grant to `anon` on purpose: the app requires login.
grant select on public.records to authenticated;
grant select, insert, update, delete on public.records to service_role;

create policy "authenticated can read records" on records
  for select to authenticated using (true);

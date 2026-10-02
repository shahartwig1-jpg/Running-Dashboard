-- ONE-PASTE VERSION: everything that is still waiting to be run, in the right order.
-- Paste the whole file into Supabase -> SQL Editor -> Run. Safe to run once; the individual
-- files (notifications.sql, roles.sql, records.sql, profiles.sql) hold the same SQL with the explanations.


-- ============================================================
-- notifications.sql
-- ============================================================
-- Run this once in the Supabase SQL Editor, after schema.sql/policies.sql/comments.sql/photos.sql.
--
-- Deliberately a SEPARATE table from `runners`, with NO policy granted to `authenticated`.
-- RLS is enabled by default on new tables (confirmed on this project), and no policy means
-- no access for anyone except the service_role key — so emails are never exposed to the
-- browser/anon/authenticated clients, only to the notify-engagement Edge Function (which
-- uses the service_role key and bypasses RLS entirely, same as fetch-data.js does).

create table if not exists runner_emails (
  "ownerId" text primary key references runners(id),
  email text not null
);

-- Required for new tables from Oct 30 (Supabase stopped granting API access automatically).
-- service_role only, on purpose — see the comment at the top of this file.
grant select, insert, update, delete on public.runner_emails to service_role;


-- ============================================================
-- roles.sql
-- ============================================================
-- Run this once in the Supabase SQL Editor.
--
-- Replaces the hardcoded "coach email" list with a real table. Before this, "who is a
-- coach" was copy-pasted in 4 places: this project's RLS policies (multi_coach.sql),
-- index.html's COACH_EMAILS, and the COACH_EMAILS default in both Edge Functions. Adding
-- or removing a coach meant editing all 4 and redeploying 3 separate systems -- and it
-- already caused a real bug once (notify-push's default was forgotten when Eyal was added,
-- so his coach push-alerts silently wouldn't have worked). Now it's one row in one table;
-- every policy and both Edge Functions read from here instead.
--
-- To add or remove a coach later, this is the only place that needs to change:
--   insert into roles (email, role) values ('someone@example.com', 'coach');
--   delete from roles where email = 'someone@example.com';

create table if not exists roles (
  email text primary key,
  role text not null check (role in ('coach'))
);

insert into roles (email, role) values
  ('shahartwig1@gmail.com', 'coach'),
  ('eyalshlomi8@gmail.com', 'coach')
on conflict (email) do nothing;

alter table roles enable row level security;

-- Not sensitive within this one trusted group (same reasoning as likes/comments/races)
-- and every "only coach" policy below needs to read this table to check membership --
-- if authenticated couldn't SELECT here, those exists(...) checks would always be false.
drop policy if exists "authenticated can read roles" on roles;
create policy "authenticated can read roles" on roles
  for select to authenticated using (true);
-- Deliberately no insert/update/delete policy for authenticated: only the service_role
-- key (used by me directly, or via the SQL Editor) can change who's a coach.

-- Swap every existing "coach" policy from a literal email list to a roles lookup.
alter policy "only coach can insert plan_history" on plan_history
  with check (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'));

alter policy "only coach can update plan_history" on plan_history
  using (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'))
  with check (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'));

alter policy "authenticated can read approved highlights" on weekly_highlights
  using (status = 'approved' or exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'));

alter policy "only coach can moderate highlights" on weekly_highlights
  using (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'))
  with check (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'));

alter policy "authenticated can read photos of visible highlights" on weekly_highlight_photos
  using (exists (
    select 1 from weekly_highlights h
    where h.id = "highlightId"
      and (h.status = 'approved' or exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'))
  ));

alter policy "only coach can add races" on races
  with check (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'));

alter policy "only coach can update races" on races
  using (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'))
  with check (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'));

alter policy "only coach can delete races" on races
  using (exists (select 1 from roles where email = (auth.jwt() ->> 'email') and role = 'coach'));


-- ============================================================
-- records.sql
-- ============================================================
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
  seconds integer not null,                -- the watch's actual stopped time, not scaled to the distance
  "distanceInMeters" integer not null,     -- the distance that run really covered (10.0 - 10.3 km for '10k')
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

drop policy if exists "authenticated can read records" on records;
create policy "authenticated can read records" on records
  for select to authenticated using (true);


-- ============================================================
-- profiles.sql
-- ============================================================
-- Run this once in the Supabase SQL Editor, AFTER notifications.sql (it needs runner_emails)
-- and, if you want coaches to be able to change anyone's photo, after roles.sql.
--
-- Runner profiles: for now just a profile photo (the stats and records on the profile page
-- are computed from data that already exists). The point of this file is WHO may change a
-- photo, enforced here in the database and not just hidden in the UI:
--   * a runner may change only their own photo, found through runner_emails (login email ->
--     runner id, filled in by a coach/the service key);
--   * a coach (roles table) may change anyone's.
-- The photo files live in the public `profile-photos` storage bucket, in a folder named
-- after the runner id, and the same rule guards uploads to that folder.

create table if not exists profiles (
  "ownerId" text primary key references runners(id) on delete cascade,
  "photoUrl" text,
  "updatedAt" timestamptz not null default now()
);

-- Which runner is the person making this request? Returns null for a login that isn't linked
-- to a runner yet. SECURITY DEFINER so it can read runner_emails, which authenticated users
-- cannot read directly; it only ever reveals the caller's OWN runner id.
create or replace function public.my_runner_id() returns text
language plpgsql security definer stable set search_path = public as $$
declare r text;
begin
  select "ownerId" into r from public.runner_emails
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;
  return r;
end $$;

create or replace function public.can_edit_profile(owner text) returns boolean
language plpgsql security definer stable set search_path = public as $$
begin
  if owner is not null and owner = public.my_runner_id() then return true; end if;
  if to_regclass('public.roles') is not null then
    return exists (select 1 from public.roles
      where lower(email) = lower(auth.jwt() ->> 'email') and role = 'coach');
  end if;
  return false;
end $$;

revoke all on function public.my_runner_id() from public;
revoke all on function public.can_edit_profile(text) from public;
grant execute on function public.my_runner_id() to authenticated;
grant execute on function public.can_edit_profile(text) to authenticated;

alter table profiles enable row level security;

-- Required for new tables from Oct 30 (Supabase stopped granting API access automatically).
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

drop policy if exists "authenticated can read profiles" on profiles;
create policy "authenticated can read profiles" on profiles
  for select to authenticated using (true);

drop policy if exists "own profile or coach: add" on profiles;
create policy "own profile or coach: add" on profiles
  for insert to authenticated with check (public.can_edit_profile("ownerId"));

drop policy if exists "own profile or coach: update" on profiles;
create policy "own profile or coach: update" on profiles
  for update to authenticated
  using (public.can_edit_profile("ownerId"))
  with check (public.can_edit_profile("ownerId"));

-- Storage: only into your own folder (profile-photos/<runnerId>/...).
drop policy if exists "own profile photo upload" on storage.objects;
create policy "own profile photo upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos' and public.can_edit_profile((storage.foldername(name))[1]));

drop policy if exists "list profile photos" on storage.objects;
create policy "list profile photos" on storage.objects
  for select to authenticated using (bucket_id = 'profile-photos');

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

-- Run this once in the Supabase SQL Editor, after schema.sql and policies.sql.

create table if not exists comments (
  id bigint generated always as identity primary key,
  "activityId" text not null,
  "authorName" text not null,
  text text not null,
  "createdAt" timestamptz not null default now()
);

create policy "authenticated can read comments" on comments
  for select to authenticated using (true);

create policy "authenticated can add comments" on comments
  for insert to authenticated with check (true);

-- One row per (activity, person) — liking again is a no-op (primary key blocks the
-- duplicate), unliking is just deleting that row. Whoever's logged in can toggle their
-- own like; this group is one trusted circle, so no stricter per-row ownership check.
create table if not exists likes (
  "activityId" text not null,
  "authorName" text not null,
  "createdAt" timestamptz not null default now(),
  primary key ("activityId", "authorName")
);

create policy "authenticated can read likes" on likes
  for select to authenticated using (true);

create policy "authenticated can add likes" on likes
  for insert to authenticated with check (true);

create policy "authenticated can remove likes" on likes
  for delete to authenticated using (true);

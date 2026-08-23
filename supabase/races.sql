-- Run this once in the Supabase SQL Editor, after schema.sql/policies.sql.
--
-- Upcoming races the group is training toward. Only the coach can add/edit/delete races
-- (same server-side-enforced pattern as plan_edit_policy.sql). Anyone logged in can RSVP
-- themselves ("I'm in") — presence of a row = attending, same design as the `likes` table
-- in comments.sql (no separate boolean column; un-checking just deletes the row). No
-- stricter per-row ownership check, same trusted-circle reasoning as likes/comments.

create table if not exists races (
  id bigint generated always as identity primary key,
  name text not null,
  date date not null,
  location text,
  "createdAt" timestamptz not null default now()
);

create policy "authenticated can read races" on races
  for select to authenticated using (true);

create policy "only coach can add races" on races
  for insert to authenticated with check ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com');

create policy "only coach can update races" on races
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com');

create policy "only coach can delete races" on races
  for delete to authenticated using ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com');

create table if not exists race_rsvps (
  "raceId" bigint not null references races(id) on delete cascade,
  "authorName" text not null,
  "createdAt" timestamptz not null default now(),
  primary key ("raceId", "authorName")
);

create policy "authenticated can read race_rsvps" on race_rsvps
  for select to authenticated using (true);

create policy "authenticated can add race_rsvps" on race_rsvps
  for insert to authenticated with check (true);

create policy "authenticated can remove race_rsvps" on race_rsvps
  for delete to authenticated using (true);

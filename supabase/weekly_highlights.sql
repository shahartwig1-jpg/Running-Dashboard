-- Run this once in the Supabase SQL Editor, after schema.sql/policies.sql.
--
-- Group "weekly highlight" posts — a description + a photo gallery for a shared group
-- activity, shown on the front page once approved. Anyone logged in can submit one; only
-- the coach can approve/reject (checked server-side via RLS, same pattern as
-- plan_edit_policy.sql — not just a hidden button). Unapproved submissions are visible
-- ONLY to the coach (so they can review/approve them), never to the rest of the group.

create table if not exists weekly_highlights (
  id bigint generated always as identity primary key,
  "weekStart" date not null,
  "authorName" text not null,
  description text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  "createdAt" timestamptz not null default now()
);

create table if not exists weekly_highlight_photos (
  id bigint generated always as identity primary key,
  "highlightId" bigint not null references weekly_highlights(id) on delete cascade,
  url text not null,
  "authorName" text not null,
  "createdAt" timestamptz not null default now()
);

-- Anyone logged in can read APPROVED highlights; only the coach can also see
-- pending/rejected ones (that's how review/approval actually happens in the UI).
create policy "authenticated can read approved highlights" on weekly_highlights
  for select to authenticated
  using (status = 'approved' or (auth.jwt() ->> 'email') = 'shahartwig1@gmail.com');

create policy "authenticated can submit highlights" on weekly_highlights
  for insert to authenticated with check (true);

create policy "only coach can moderate highlights" on weekly_highlights
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com');

-- Photos inherit their parent highlight's visibility rule.
create policy "authenticated can read photos of visible highlights" on weekly_highlight_photos
  for select to authenticated
  using (exists (
    select 1 from weekly_highlights h
    where h.id = "highlightId" and (h.status = 'approved' or (auth.jwt() ->> 'email') = 'shahartwig1@gmail.com')
  ));

create policy "authenticated can add highlight photos" on weekly_highlight_photos
  for insert to authenticated with check (true);

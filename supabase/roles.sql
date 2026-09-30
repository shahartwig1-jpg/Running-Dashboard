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

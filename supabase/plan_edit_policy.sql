-- Run this once in the Supabase SQL Editor, after schema.sql/policies.sql.
--
-- Everyone can already READ plan_history (see policies.sql). This adds WRITE access,
-- restricted to the coach's account only — the in-app plan editor writes directly from
-- the browser using the logged-in user's own session (not the service_role key), so this
-- policy is what actually enforces "only the coach can edit", not just hiding the Edit
-- button for everyone else.

create policy "only coach can insert plan_history" on plan_history
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com');

create policy "only coach can update plan_history" on plan_history
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'shahartwig1@gmail.com');

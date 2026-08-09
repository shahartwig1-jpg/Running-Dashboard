-- Run this once in the Supabase SQL Editor, after schema.sql.
-- Allows read access to logged-in users only (the "authenticated" role);
-- anonymous visitors and write access stay blocked. The fetch-data.js script
-- is unaffected — it uses the service_role key, which bypasses RLS entirely.

create policy "authenticated can read runners" on runners
  for select to authenticated using (true);

create policy "authenticated can read activities" on activities
  for select to authenticated using (true);

create policy "authenticated can read activity_details" on activity_details
  for select to authenticated using (true);

create policy "authenticated can read sleep" on sleep
  for select to authenticated using (true);

create policy "authenticated can read plan_history" on plan_history
  for select to authenticated using (true);

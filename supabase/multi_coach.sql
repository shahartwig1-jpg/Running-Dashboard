-- Run this once in the Supabase SQL Editor.
--
-- Adds Eyal as a second coach, everywhere "coach" is checked server-side (this is the real
-- enforcement — the app's own isCoach() check is only a UI convenience). Existing policies
-- are updated in place with ALTER POLICY, so their names and the rest of each file stay the
-- reference for what's actually running.

alter policy "only coach can insert plan_history" on plan_history
  with check ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'));

alter policy "only coach can update plan_history" on plan_history
  using ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'));

alter policy "authenticated can read approved highlights" on weekly_highlights
  using (status = 'approved' or (auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'));

alter policy "only coach can moderate highlights" on weekly_highlights
  using ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'));

alter policy "authenticated can read photos of visible highlights" on weekly_highlight_photos
  using (exists (
    select 1 from weekly_highlights h
    where h.id = "highlightId"
      and (h.status = 'approved' or (auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'))
  ));

alter policy "only coach can add races" on races
  with check ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'));

alter policy "only coach can update races" on races
  using ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'));

alter policy "only coach can delete races" on races
  using ((auth.jwt() ->> 'email') in ('shahartwig1@gmail.com', 'eyalshlomi8@gmail.com'));

-- Run this once in the Supabase SQL Editor (after notifications.sql / run_all_pending.sql).
--
-- Likes, comments, race sign-ups, highlights and photos are saved under a short name: the part of the
-- login email before the "@" (for example "omer.goren10"). This function lets the dashboard turn that
-- short name into the runner it belongs to, so people see "Omer" and his profile photo instead.
--
-- It only returns the short names the dashboard already shows next to every like and comment, never a
-- full email address. SECURITY DEFINER because runner_emails itself is not readable by logged-in users.

create or replace function public.author_runners() returns table (author text, "ownerId" text)
language sql security definer stable set search_path = public as $$
  select lower(split_part(email, '@', 1)) as author, "ownerId" from public.runner_emails
$$;

revoke all on function public.author_runners() from public;
grant execute on function public.author_runners() to authenticated;

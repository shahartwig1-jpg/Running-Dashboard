-- Run this once in the Supabase SQL Editor.
--
-- The "address book" for push notifications: one row per phone/browser that tapped
-- "Enable notifications". `endpoint` is the unique address the browser gives us for that
-- device; the two keys are what the server needs to encrypt a message to it.
--
-- Each person can only see/change their OWN rows (auth.uid() = userId), and the email must
-- match their login, so nobody can subscribe a device under someone else's name. The
-- notify-push Edge Function reads all rows with the service_role key.
--
-- The GRANT lines are required for new tables from Oct 30 (Supabase stopped granting API
-- access automatically). No grant to `anon` on purpose: the app requires login.

create table if not exists push_subscriptions (
  endpoint text primary key,
  "userId" uuid not null default auth.uid(),
  email text not null,
  p256dh text not null,
  auth text not null,
  "createdAt" timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

create policy "own push subscriptions: read" on push_subscriptions
  for select to authenticated using (auth.uid() = "userId");

create policy "own push subscriptions: add" on push_subscriptions
  for insert to authenticated
  with check (auth.uid() = "userId" and lower(email) = lower(auth.jwt() ->> 'email'));

create policy "own push subscriptions: update" on push_subscriptions
  for update to authenticated
  using (auth.uid() = "userId")
  with check (auth.uid() = "userId" and lower(email) = lower(auth.jwt() ->> 'email'));

create policy "own push subscriptions: remove" on push_subscriptions
  for delete to authenticated using (auth.uid() = "userId");

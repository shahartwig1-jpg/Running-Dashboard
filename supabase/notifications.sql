-- Run this once in the Supabase SQL Editor, after schema.sql/policies.sql/comments.sql/photos.sql.
--
-- Deliberately a SEPARATE table from `runners`, with NO policy granted to `authenticated`.
-- RLS is enabled by default on new tables (confirmed on this project), and no policy means
-- no access for anyone except the service_role key — so emails are never exposed to the
-- browser/anon/authenticated clients, only to the notify-engagement Edge Function (which
-- uses the service_role key and bypasses RLS entirely, same as fetch-data.js does).

create table if not exists runner_emails (
  "ownerId" text primary key references runners(id),
  email text not null
);

-- Run this once in the Supabase SQL Editor, after schema.sql/policies.sql.
--
-- Supports auto-hiding runs that vanish from Intervals.icu's activity list without
-- returning a real 404 on direct lookup (confirmed real, undocumented platform quirk —
-- not something fetch-data.js can tell apart from an actual deletion). A confirmed 404
-- still triggers a real delete; this column is for the "can't be sure" case, so the run
-- disappears from the dashboard automatically either way, but nothing is destroyed if it
-- turns out to just be a temporary listing quirk.

alter table activities add column if not exists hidden boolean not null default false;

-- Run this once in the Supabase SQL Editor, after schema.sql/policies.sql/comments.sql.
-- The "activity-photos" storage bucket itself was already created via the Storage API
-- (public read) — this just adds the metadata table and the upload permission.

create table if not exists activity_photos (
  id bigint generated always as identity primary key,
  "activityId" text not null,
  "authorName" text not null,
  url text not null,
  "createdAt" timestamptz not null default now()
);

create policy "authenticated can read photo metadata" on activity_photos
  for select to authenticated using (true);

create policy "authenticated can add photo metadata" on activity_photos
  for insert to authenticated with check (true);

-- Storage-level permission: who can actually upload a file into the bucket.
create policy "authenticated can upload activity photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'activity-photos');

create policy "authenticated can list activity photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'activity-photos');

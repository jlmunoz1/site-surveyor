-- Run this in Supabase Dashboard → SQL Editor → New query
-- Requires supabase-team-sharing-migration.sql to have been run first
-- (this depends on the "profiles" table it creates).

-- ── Add an admin flag to profiles ──────────────────────────────────────
alter table profiles add column if not exists is_admin boolean default false;

-- Let admins update ANY profile (e.g. to promote/demote other admins),
-- while everyone else can still only update their own row.
drop policy if exists "Admins manage any profile" on profiles;
create policy "Admins manage any profile"
  on profiles for update
  to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true))
  with check (true);

-- ── Make yourself the first admin ──────────────────────────────────────
-- Replace 'you@company.com' with the email you log into the app with,
-- then run just this line (or re-run the whole file — it's safe either way).
update profiles set is_admin = true where email = 'you@company.com';

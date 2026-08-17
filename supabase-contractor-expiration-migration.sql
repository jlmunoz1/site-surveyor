-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
-- Requires the team-sharing and admin migrations to have already run.
--
-- Adds an optional expiration date to accounts (for contractors), and
-- enforces it at the database level — an expired account is blocked
-- from reading/writing surveys or projects even via a direct API call,
-- not just hidden in the UI.

alter table profiles add column if not exists access_expires_at timestamptz;

-- Returns true if the currently logged-in user has no expiration set,
-- or their expiration hasn't passed yet.
create or replace function public.has_valid_access()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (select access_expires_at is null or access_expires_at > now()
     from profiles where id = auth.uid()),
    false
  )
$$;

-- ── Surveys: add the expiration check to every policy ──────────────────
drop policy if exists "Any authenticated user can view surveys" on surveys;
create policy "Any authenticated user can view surveys"
  on surveys for select
  to authenticated
  using (has_valid_access());

drop policy if exists "Owners insert their own surveys" on surveys;
create policy "Owners insert their own surveys"
  on surveys for insert
  to authenticated
  with check (auth.uid() = user_id and has_valid_access());

drop policy if exists "Owners update their own surveys" on surveys;
create policy "Owners update their own surveys"
  on surveys for update
  to authenticated
  using (auth.uid() = user_id and has_valid_access())
  with check (auth.uid() = user_id and has_valid_access());

drop policy if exists "Owners delete their own surveys" on surveys;
create policy "Owners delete their own surveys"
  on surveys for delete
  to authenticated
  using (auth.uid() = user_id and has_valid_access());

-- ── Projects: same pattern ──────────────────────────────────────────────
drop policy if exists "Any authenticated user can view projects" on projects;
create policy "Any authenticated user can view projects"
  on projects for select
  to authenticated
  using (has_valid_access());

drop policy if exists "Owners insert their own projects" on projects;
create policy "Owners insert their own projects"
  on projects for insert
  to authenticated
  with check (auth.uid() = user_id and has_valid_access());

drop policy if exists "Owners update their own projects" on projects;
create policy "Owners update their own projects"
  on projects for update
  to authenticated
  using (auth.uid() = user_id and has_valid_access())
  with check (auth.uid() = user_id and has_valid_access());

drop policy if exists "Owners delete their own projects" on projects;
create policy "Owners delete their own projects"
  on projects for delete
  to authenticated
  using (auth.uid() = user_id and has_valid_access());

-- Note: profiles SELECT stays open to all authenticated users regardless
-- of expiration, so an expired person's own app can still detect their
-- expiration status and show them a clear message instead of a silent
-- empty dashboard. Admins can still update any profile (including
-- access_expires_at) via the existing "Admins manage any profile" policy.

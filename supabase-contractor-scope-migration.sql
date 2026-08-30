-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
-- Requires the team-sharing, admin, contractor-expiration, and
-- project-invites migrations to have already run.
--
-- FIXES: newly invited contractors see every project in the org, not
-- just the one(s) they were invited to.
--
-- Root cause: the "staff" branch of the projects/surveys SELECT (and
-- UPDATE) policies grants full org-wide visibility to anyone whose
-- profile has no access_expires_at set — i.e. anyone who isn't
-- explicitly flagged as a time-limited contractor. New accounts
-- default to access_expires_at = null, so a contractor who signs up
-- in response to a project invite was being treated as staff by
-- default and could see everything, not just their invited project.
--
-- This adds a dedicated is_contractor flag, decoupled from
-- access_expires_at (which controls whether access works AT ALL, not
-- how much of the org it covers — those are separate concerns). New
-- accounts are auto-flagged as a contractor at signup if their email
-- already has a pending invite in project_members; existing accounts
-- are untouched; you can also flip anyone's flag manually in /admin.

alter table profiles add column if not exists is_contractor boolean default false;

-- Auto-create a profile row whenever someone signs up — same as the
-- team-sharing migration's version, but now also flags the new
-- account as a contractor if they were invited to a project before
-- they ever created an account (the normal signup-after-invite flow).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, is_contractor)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    exists (select 1 from project_members where lower(email) = lower(new.email))
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- ── Projects: staff-wide visibility now also requires NOT being a contractor
drop policy if exists "Owners, invited members, staff, and admins can view projects" on projects;
create policy "Owners, invited members, staff, and admins can view projects"
  on projects for select
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or is_project_member(id)
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or (p.access_expires_at is null and p.is_contractor = false))
      )
    )
  );

drop policy if exists "Owners, invited members, staff, and admins can update projects" on projects;
create policy "Owners, invited members, staff, and admins can update projects"
  on projects for update
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or is_project_member(id)
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or (p.access_expires_at is null and p.is_contractor = false))
      )
    )
  )
  with check (
    has_valid_access() and (
      auth.uid() = user_id
      or is_project_member(id)
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or (p.access_expires_at is null and p.is_contractor = false))
      )
    )
  );

-- ── Surveys: same pattern
drop policy if exists "Owners, invited members, staff, and admins can view surveys" on surveys;
create policy "Owners, invited members, staff, and admins can view surveys"
  on surveys for select
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or (project_id is not null and is_project_member(project_id))
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or (p.access_expires_at is null and p.is_contractor = false))
      )
    )
  );

drop policy if exists "Owners, invited members, staff, and admins can update surveys" on surveys;
create policy "Owners, invited members, staff, and admins can update surveys"
  on surveys for update
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or (project_id is not null and is_project_member(project_id))
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or (p.access_expires_at is null and p.is_contractor = false))
      )
    )
  )
  with check (
    has_valid_access() and (
      auth.uid() = user_id
      or (project_id is not null and is_project_member(project_id))
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or (p.access_expires_at is null and p.is_contractor = false))
      )
    )
  );

-- Note: existing accounts all default to is_contractor = false (staff,
-- full visibility) since the column defaults to false and this
-- migration doesn't touch any existing profiles rows — your current
-- team's access is unaffected. Only NEW signups that come in response
-- to a project invite get auto-scoped going forward. Use /admin to
-- manually flip the flag on any account (e.g. to scope down an
-- existing staff account, or promote a contractor to full staff
-- access once they join the team properly).

-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
-- Requires the team-sharing, admin, contractor-expiration, and
-- project-invites migrations to have already run.
--
-- FIXES: edits made to a survey (or project) in someone else's "Team
-- Projects" folder don't stick, while edits in "My Projects" do.
--
-- Root cause: when project-based invitations were added, the SELECT
-- policies on surveys/projects were widened to let an invited member,
-- staff, or admin VIEW a shared item — but the UPDATE policies were
-- never widened to match. They're still "auth.uid() = user_id" only.
-- So an invited teammate or contractor can open and edit a shared
-- survey in the UI, click Save, and get a normal-looking "Saved"
-- confirmation — but Postgres RLS quietly matches zero rows on the
-- update and nothing is written. No error is thrown; it just doesn't
-- take, which is exactly what you're seeing.
--
-- This brings UPDATE in line with the existing SELECT policy on both
-- tables: an invited project member, staff (no expiration set), or an
-- admin can now actually save changes, not just the literal owner.

-- ── Surveys ──────────────────────────────────────────────────────────────
drop policy if exists "Owners update their own surveys" on surveys;
create policy "Owners, invited members, staff, and admins can update surveys"
  on surveys for update
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or (project_id is not null and is_project_member(project_id))
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  )
  with check (
    has_valid_access() and (
      auth.uid() = user_id
      or (project_id is not null and is_project_member(project_id))
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

-- ── Projects ─────────────────────────────────────────────────────────────
-- Same pattern — lets an invited member rename a shared project, set its
-- Port Mapper site id, etc., not just view it.
drop policy if exists "Owners update their own projects" on projects;
create policy "Owners, invited members, staff, and admins can update projects"
  on projects for update
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or is_project_member(id)
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  )
  with check (
    has_valid_access() and (
      auth.uid() = user_id
      or is_project_member(id)
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

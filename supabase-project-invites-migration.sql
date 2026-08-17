-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
-- Requires the team-sharing, admin, and contractor-expiration migrations
-- to have already run.
--
-- Moves from "any authenticated user sees every project" to per-project
-- invitations: a project (and its surveys) is now only visible to its
-- owner, anyone specifically invited to it, or an admin. Regular team
-- members and contractors only see projects they created or were
-- invited to — not the whole org's projects by default.

-- ── Invitations ─────────────────────────────────────────────────────────
create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  invited_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique(project_id, email)
);

alter table project_members enable row level security;

drop policy if exists "Project owners manage their project's members" on project_members;
create policy "Project owners manage their project's members"
  on project_members for all
  to authenticated
  using (exists (select 1 from projects p where p.id = project_members.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_members.project_id and p.user_id = auth.uid()));

drop policy if exists "Invited users can see their own membership rows" on project_members;
create policy "Invited users can see their own membership rows"
  on project_members for select
  to authenticated
  using (lower(email) = lower(auth.email()));

-- ── Projects: owner, invited member, staff, or admin can view ───────────
-- "Staff" = no access_expires_at set at all (matches the contractor-
-- expiration migration: only contractors get a limit put on them).
-- Staff and admins keep full org-wide visibility, same as before.
-- Contractors (anyone with an expiration date, expired or not) are
-- scoped down to only projects they own or were explicitly invited to.
drop policy if exists "Any authenticated user can view projects" on projects;
drop policy if exists "Owners and invited members can view projects" on projects;
create policy "Owners, invited members, staff, and admins can view projects"
  on projects for select
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or exists (select 1 from project_members pm where pm.project_id = projects.id and lower(pm.email) = lower(auth.email()))
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

-- ── Surveys: same pattern ────────────────────────────────────────────────
drop policy if exists "Any authenticated user can view surveys" on surveys;
drop policy if exists "Owners and invited members can view surveys" on surveys;
create policy "Owners, invited members, staff, and admins can view surveys"
  on surveys for select
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or (project_id is not null and exists (
        select 1 from project_members pm where pm.project_id = surveys.project_id and lower(pm.email) = lower(auth.email())
      ))
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

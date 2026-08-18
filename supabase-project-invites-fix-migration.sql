-- Run this in SITE SURVEYOR's Supabase. This FIXES the previous
-- project-invites migration, which caused a 500 error on every load of
-- the Dashboard — it referenced auth.email(), a helper function that
-- isn't available in this Supabase project. This version gets the
-- current user's email by joining through "profiles" via auth.uid()
-- instead, which we've already confirmed works throughout this project.

drop policy if exists "Invited users can see their own membership rows" on project_members;
create policy "Invited users can see their own membership rows"
  on project_members for select
  to authenticated
  using (
    exists (
      select 1 from profiles me
      where me.id = auth.uid() and lower(me.email) = lower(project_members.email)
    )
  );

drop policy if exists "Owners, invited members, staff, and admins can view projects" on projects;
create policy "Owners, invited members, staff, and admins can view projects"
  on projects for select
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or exists (
        select 1 from project_members pm
        join profiles me on me.id = auth.uid()
        where pm.project_id = projects.id and lower(pm.email) = lower(me.email)
      )
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

drop policy if exists "Owners, invited members, staff, and admins can view surveys" on surveys;
create policy "Owners, invited members, staff, and admins can view surveys"
  on surveys for select
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or (project_id is not null and exists (
        select 1 from project_members pm
        join profiles me on me.id = auth.uid()
        where pm.project_id = surveys.project_id and lower(pm.email) = lower(me.email)
      ))
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

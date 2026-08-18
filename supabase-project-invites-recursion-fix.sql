-- Run this in SITE SURVEYOR's Supabase. Fixes a 500 error ("infinite
-- recursion detected in policy", Postgres code 42P17) caused by the
-- projects policy checking project_members, while the project_members
-- policy checks projects — each one re-triggers the other in a loop.
--
-- Fix: wrap each cross-table check in a SECURITY DEFINER function.
-- Those run with elevated privileges internally, so checking one
-- table's data doesn't re-trigger the other table's RLS policy —
-- breaking the cycle. This is the same technique already used
-- successfully for has_valid_access().

create or replace function public.is_project_owner(pid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from projects where id = pid and user_id = auth.uid());
$$;

create or replace function public.is_project_member(pid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from project_members pm
    join profiles me on me.id = auth.uid()
    where pm.project_id = pid and lower(pm.email) = lower(me.email)
  );
$$;

-- ── project_members: use the helper instead of querying projects directly
drop policy if exists "Project owners manage their project's members" on project_members;
create policy "Project owners manage their project's members"
  on project_members for all
  to authenticated
  using (is_project_owner(project_id))
  with check (is_project_owner(project_id));

-- ── projects: use the helper instead of querying project_members directly
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
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

-- ── surveys: same helper, since it hit the same cycle through projects
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
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

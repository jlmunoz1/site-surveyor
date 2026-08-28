-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
-- Requires the admin, team-sharing, contractor-expiration, and
-- team-update-access migrations to have already run (uses
-- has_valid_access() and the profiles.is_admin/access_expires_at
-- pattern established there).
--
-- Adds an "Enterprise" grouping level above Projects — e.g. a customer
-- or client organization that owns several sites/buildings, each of
-- which is one of your existing Projects. A Project's enterprise_id is
-- nullable on purpose: existing projects keep working exactly as they
-- do today, showing up in an "Unassigned" bucket until someone
-- explicitly files them under an Enterprise.

create table if not exists enterprises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  created_at timestamptz default now()
);

alter table enterprises enable row level security;

-- Read access follows the same "owner, staff, or admin" shape used
-- elsewhere — an enterprise name isn't sensitive data, and staff/admins
-- already see every project regardless, so there's no reason to hide
-- the folder label above it.
drop policy if exists "Owners, staff, and admins can view enterprises" on enterprises;
create policy "Owners, staff, and admins can view enterprises"
  on enterprises for select
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

drop policy if exists "Authenticated users can create enterprises" on enterprises;
create policy "Authenticated users can create enterprises"
  on enterprises for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Same broadened update pattern as projects/surveys: owner, staff
-- (no access_expires_at set), or admin can rename it.
drop policy if exists "Owners, staff, and admins can update enterprises" on enterprises;
create policy "Owners, staff, and admins can update enterprises"
  on enterprises for update
  to authenticated
  using (
    has_valid_access() and (
      auth.uid() = user_id
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  )
  with check (
    has_valid_access() and (
      auth.uid() = user_id
      or exists (
        select 1 from profiles p where p.id = auth.uid()
        and (p.is_admin = true or p.access_expires_at is null)
      )
    )
  );

-- Delete stays owner-or-admin only, deliberately narrower than
-- update/select — same reasoning as projects/surveys delete.
drop policy if exists "Owners and admins can delete enterprises" on enterprises;
create policy "Owners and admins can delete enterprises"
  on enterprises for delete
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- Projects opt into an Enterprise; "on delete set null" means deleting
-- an Enterprise un-assigns its projects (back to "Unassigned") rather
-- than deleting the projects themselves — the safer default.
alter table projects add column if not exists enterprise_id uuid references enterprises(id) on delete set null;
create index if not exists projects_enterprise_id_idx on projects(enterprise_id);

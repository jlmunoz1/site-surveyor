-- Run this in SITE SURVEYOR's Supabase SQL Editor.
--
-- WHY THIS EXISTS
-- The original policy "Users manage own profile" let ANY logged-in user
-- change ANY column of their own profile row. Because role, scope, access
-- end date and email all live on that row, that meant a user could - using
-- the public API key and their own login - make themselves an admin, clear
-- their own access end date (undoing a revoke), step out of contractor
-- scoping, or delete their row and re-create it with default full access.
-- Revoking someone's access is meaningless while they can reverse it.
--
-- WHAT THIS CHANGES
--   * Regular users can still change their own display name - nothing else.
--   * Only an admin whose own access is still valid can change roles,
--     scope, access dates or emails (the Admin page keeps working as-is).
--   * Nobody can insert or delete profile rows from the browser. Profiles
--     are created by the signup trigger / the server (ensure-profile and the
--     invite flow), which are unaffected.
--   * An admin whose access has been revoked or has expired loses their
--     admin powers too, and gets them back if access is restored.
--
-- Safe to re-run. If you ever need to fix an account by hand, the SQL
-- editor still works (it has no end-user identity, so the guard allows it).

-- 1) "Is the caller an admin whose access is still valid?"
create or replace function public.is_active_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_admin and (access_expires_at is null or access_expires_at > now())
     from profiles where id = auth.uid()),
    false
  )
$$;

-- 2) Replace the all-powerful policy with an update-only one.
--    (No insert/delete policy remains, so the browser can't do either.)
drop policy if exists "Users manage own profile" on profiles;
drop policy if exists "Users update their own profile" on profiles;
create policy "Users update their own profile"
  on profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3) Admins can edit any profile - but only while their own access is valid.
drop policy if exists "Admins manage any profile" on profiles;
create policy "Admins manage any profile"
  on profiles for update
  to authenticated
  using (public.is_active_admin())
  with check (true);

-- 4) The guard: policies can't restrict individual columns, so a trigger
--    does. A non-admin may only change full_name; if anything else about
--    the row differs, the update is refused. Comparing the whole row minus
--    full_name also means any column added to profiles later is protected
--    by default.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Server-side code and the SQL editor carry no end-user identity.
  if auth.uid() is null then
    return new;
  end if;
  -- Admins (with valid access) may change anything.
  if public.is_active_admin() then
    return new;
  end if;
  if (to_jsonb(new) - 'full_name') is distinct from (to_jsonb(old) - 'full_name') then
    raise exception 'Only an admin can change an account''s role, scope, access, or email'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- 5) AUDIT - because the hole above existed until now, check that the
--    admins listed below are people who are SUPPOSED to be admins. If you
--    see anyone you don't recognize, demote them from the Admin page (or
--    run: update profiles set is_admin = false where email = '...';)
select email, full_name, is_admin, is_contractor, access_expires_at, created_at
from profiles
where is_admin = true
order by created_at;

-- Run this entire file in Supabase Dashboard → SQL Editor → New query
-- This adds team-wide sharing: everyone (staff + contractors) can VIEW
-- every project/survey, but only the original creator can edit/delete
-- their own. It also adds a "profiles" table so the app can show who
-- created each project/survey.

-- ── Profiles (mirrors auth.users, publicly readable) ───────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

drop policy if exists "Anyone can view profiles" on profiles;
create policy "Anyone can view profiles"
  on profiles for select
  to authenticated
  using (true);

drop policy if exists "Users manage own profile" on profiles;
create policy "Users manage own profile"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up (staff or contractor)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill profiles for any accounts that already existed before this migration
insert into public.profiles (id, email, full_name)
select id, email, raw_user_meta_data->>'full_name' from auth.users
on conflict (id) do nothing;

-- ── Surveys: everyone can view, only the owner can edit/delete ─────────
drop policy if exists "Users manage own surveys" on surveys;

drop policy if exists "Any authenticated user can view surveys" on surveys;
create policy "Any authenticated user can view surveys"
  on surveys for select
  to authenticated
  using (true);

drop policy if exists "Owners insert their own surveys" on surveys;
create policy "Owners insert their own surveys"
  on surveys for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Owners update their own surveys" on surveys;
create policy "Owners update their own surveys"
  on surveys for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners delete their own surveys" on surveys;
create policy "Owners delete their own surveys"
  on surveys for delete
  to authenticated
  using (auth.uid() = user_id);

-- ── Projects: same pattern ───────────────────────────────────────────
drop policy if exists "Users manage own projects" on projects;

drop policy if exists "Any authenticated user can view projects" on projects;
create policy "Any authenticated user can view projects"
  on projects for select
  to authenticated
  using (true);

drop policy if exists "Owners insert their own projects" on projects;
create policy "Owners insert their own projects"
  on projects for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Owners update their own projects" on projects;
create policy "Owners update their own projects"
  on projects for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners delete their own projects" on projects;
create policy "Owners delete their own projects"
  on projects for delete
  to authenticated
  using (auth.uid() = user_id);

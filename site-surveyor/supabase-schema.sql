-- Run this entire file in your Supabase SQL editor (Dashboard → SQL Editor → New query)

-- Surveys table
create table surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  devices jsonb default '[]',
  cables jsonb default '[]',
  svg_markup text default '',
  px_per_ft numeric default 4,
  floor_plan_url text default '',
  floor_plan_rotation integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Share tokens table
create table share_tokens (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid references surveys(id) on delete cascade not null,
  token text unique not null,
  created_at timestamptz default now()
);

-- Row Level Security: users can only see their own surveys
alter table surveys enable row level security;
alter table share_tokens enable row level security;

create policy "Users manage own surveys"
  on surveys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Anyone can read share tokens"
  on share_tokens for select
  using (true);

create policy "Owners create share tokens"
  on share_tokens for insert
  with check (
    auth.uid() = (select user_id from surveys where id = survey_id)
  );

-- Floor plan storage bucket
insert into storage.buckets (id, name, public) values ('floor-plans', 'floor-plans', true);

create policy "Owners upload floor plans"
  on storage.objects for insert
  with check (bucket_id = 'floor-plans' and auth.uid() is not null);

create policy "Anyone can view floor plans"
  on storage.objects for select
  using (bucket_id = 'floor-plans');

create policy "Owners delete floor plans"
  on storage.objects for delete
  using (bucket_id = 'floor-plans' and auth.uid() is not null);

-- Run this if you already created the table previously (adds rotation column)
alter table surveys add column if not exists floor_plan_rotation integer default 0;

-- ============================================================
-- Run these if you already have the surveys table set up
-- ============================================================

-- Projects table
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  created_at timestamptz default now()
);

alter table projects enable row level security;

create policy "Users manage own projects"
  on projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Add new columns to surveys
alter table surveys add column if not exists project_id uuid references projects(id) on delete set null;
alter table surveys add column if not exists icon_size integer default 38;
alter table surveys add column if not exists floor_plan_rotation integer default 0;

-- Add icon_sizes column (JSON object per category)
alter table surveys add column if not exists icon_sizes jsonb default '{"cameras":16,"lora":20,"network":20,"access":16}';

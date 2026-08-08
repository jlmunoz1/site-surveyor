-- ============================================================
-- Sage Port Mapper — Supabase Schema
-- Paste this entire file into Supabase → SQL Editor → Run
-- ============================================================

-- User profiles (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  role text not null default 'readonly' check (role in ('admin', 'tech', 'readonly')),
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

-- Admins can do everything; techs/readonly can only read
create policy "Profiles: admin full access" on public.profiles
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
create policy "Profiles: users can read own" on public.profiles
  for select using (id = auth.uid());
create policy "Profiles: users can update own name" on public.profiles
  for update using (id = auth.uid());

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'readonly');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Sites (facilities)
create table public.sites (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  location text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.sites enable row level security;
create policy "Sites: all authenticated can read" on public.sites
  for select using (auth.role() = 'authenticated');
create policy "Sites: admin and tech can insert" on public.sites
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','tech'))
  );
create policy "Sites: admin and tech can update" on public.sites
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','tech'))
  );
create policy "Sites: only admin can delete" on public.sites
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Racks
create table public.racks (
  id uuid default gen_random_uuid() primary key,
  site_id uuid references public.sites(id) on delete cascade not null,
  name text not null,
  u_size int default 6,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.racks enable row level security;
create policy "Racks: all authenticated can read" on public.racks
  for select using (auth.role() = 'authenticated');
create policy "Racks: admin and tech can write" on public.racks
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','tech'))
  );

-- Devices (slots in a rack)
create table public.devices (
  id uuid default gen_random_uuid() primary key,
  rack_id uuid references public.racks(id) on delete cascade not null,
  label text not null,
  device_key text not null,
  color text default 'blue',
  u_size int default 1,
  sort_order int default 0,
  ports int default 0,
  sfp_start int,
  sfp_count int,
  rj45_1g int,
  rj45_25g int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.devices enable row level security;
create policy "Devices: all authenticated can read" on public.devices
  for select using (auth.role() = 'authenticated');
create policy "Devices: admin and tech can write" on public.devices
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','tech'))
  );

-- Port data
create table public.ports (
  id uuid default gen_random_uuid() primary key,
  device_id uuid references public.devices(id) on delete cascade not null,
  port_num int not null,
  connected_device text default '',
  jack_label text default '',
  status text default 'unused' check (status in ('unused','used','reserved','issue')),
  notes text default '',
  updated_at timestamptz default now(),
  updated_by uuid references public.profiles(id),
  unique(device_id, port_num)
);
alter table public.ports enable row level security;
create policy "Ports: all authenticated can read" on public.ports
  for select using (auth.role() = 'authenticated');
create policy "Ports: admin and tech can write" on public.ports
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','tech'))
  );

-- Network map nodes
create table public.map_nodes (
  id uuid default gen_random_uuid() primary key,
  site_id uuid references public.sites(id) on delete cascade,
  label text not null,
  type text not null default 'idf',
  sub_label text,
  pos_x float default 0,
  pos_y float default 0,
  created_at timestamptz default now()
);
alter table public.map_nodes enable row level security;
create policy "Map nodes: all authenticated can read" on public.map_nodes
  for select using (auth.role() = 'authenticated');
create policy "Map nodes: admin and tech can write" on public.map_nodes
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','tech'))
  );

-- Network map links
create table public.map_links (
  id uuid default gen_random_uuid() primary key,
  from_id uuid references public.map_nodes(id) on delete cascade not null,
  to_id uuid references public.map_nodes(id) on delete cascade not null,
  link_type text default 'backbone',
  label text default '',
  created_at timestamptz default now()
);
alter table public.map_links enable row level security;
create policy "Map links: all authenticated can read" on public.map_links
  for select using (auth.role() = 'authenticated');
create policy "Map links: admin and tech can write" on public.map_links
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','tech'))
  );

-- Port guide rules
create table public.port_rules (
  id uuid default gen_random_uuid() primary key,
  device_name text not null,
  icon text default 'ti-plug',
  color text default '#475569',
  bg_color text default '#f1f5f9',
  switch_target text,
  port_hint text,
  poe_req text default 'PoE+',
  reason text,
  category text default 'General',
  sort_order int default 0,
  created_at timestamptz default now()
);
alter table public.port_rules enable row level security;
create policy "Port rules: all authenticated can read" on public.port_rules
  for select using (auth.role() = 'authenticated');
create policy "Port rules: only admin can write" on public.port_rules
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Seed default port rules
insert into public.port_rules (device_name, icon, color, bg_color, switch_target, port_hint, poe_req, reason, category, sort_order) values
  ('RAK LoRa Gateway',      'ti-antenna-bars-5', '#1e40af', '#dbeafe', 'Mission Critical',  'Any PoE+ port (1–8)',    'PoE+',  'Requires PoE+. Mission Critical provides battery backup to keep LoRa online during power outages.', 'LoRa / Connectivity', 1),
  ('5G Backup (Max device)','ti-signal-5g',      '#6d28d9', '#ede9fe', 'UCG-Fiber',         'Port 4 (PoE++)',         'PoE++', 'Requires PoE++ (60W). Must be Port 4 on UCG-Fiber.',                                               'WAN / Backup',        2),
  ('Data Uplink',           'ti-network',        '#0891b2', '#e0f2fe', 'UCG-Fiber',         'Port 5',                'None',  'Data uplink connection goes into Port 5 on UCG-Fiber.',                                           'WAN / Backup',        3),
  ('IP Camera',             'ti-camera',         '#0891b2', '#e0f2fe', 'USW-Pro-Max (any)', 'Any PoE+ port',         'PoE+',  'Cameras connect to Pro-Max switches. PoE+ (30W) is sufficient for most IP cameras.',               'Security',            4),
  ('Sage Gateways',         'ti-bell-ringing',   '#dc2626', '#fee2e2', 'Mission Critical',  'Any PoE+ port (1–8)',   'PoE+',  'Must be on Mission Critical for battery backup.',                                                  'Life Safety',         5),
  ('Door Access Controller','ti-door',           '#7c3aed', '#ede9fe', 'Mission Critical',  'Any PoE+ port (1–8)',   'PoE+',  'Door access must remain functional during outages. Battery backup required.',                    'Access Control',      6),
  ('Uplink / Backbone',     'ti-arrow-up-right', '#475569', '#f1f5f9', 'Any Pro-Max',       'SFP+ ports (10G)',      'None',  'Use SFP+ ports for all switch-to-switch uplinks for maximum bandwidth.',                        'Infrastructure',      7);


-- ============================================================
-- Migration: Add sort_order to racks for drag-to-reorder
-- Run this if you already have an existing database
-- ============================================================
alter table public.racks add column if not exists sort_order int default 0;


-- ============================================================
-- Migration: Prevent duplicate map nodes per site+label
-- Run this once to enforce uniqueness at the database level
-- ============================================================
ALTER TABLE public.map_nodes 
  ADD CONSTRAINT map_nodes_site_label_unique UNIQUE (site_id, label);


-- ============================================================
-- Migration: Add u_start to devices for community rack U positioning
-- ============================================================
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS u_start int DEFAULT NULL;


-- ============================================================
-- Migration: Add mount_mode to devices
-- ============================================================
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS mount_mode text DEFAULT 'rack';
UPDATE public.devices SET mount_mode = 'wall' WHERE device_key IN ('USW-Flex-Mini','USW-Ultra') AND u_size = 0;
UPDATE public.devices SET mount_mode = 'floor' WHERE device_key = 'UUPS-TOWER' AND u_size = 0;
UPDATE public.devices SET mount_mode = 'rack' WHERE mount_mode IS NULL;

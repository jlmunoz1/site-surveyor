-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz),
-- NOT Port Mapper's. This lets Site Surveyor remember which Port Mapper
-- site each project corresponds to, so racks can be created in the
-- right place.

alter table projects add column if not exists port_mapper_site_id uuid;

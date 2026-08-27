-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
--
-- Adds a site address to projects — one address per building, shared by
-- every floor/survey inside that project. address_lat/address_lng cache
-- the geocoded result so the georeferencing map can jump straight to
-- the right building without re-geocoding (and re-hitting the free
-- OpenStreetMap Nominatim geocoder) every time a survey is opened.

alter table projects add column if not exists address text;
alter table projects add column if not exists address_lat numeric;
alter table projects add column if not exists address_lng numeric;

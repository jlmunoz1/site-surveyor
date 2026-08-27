-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
--
-- Adds georeferencing storage to surveys: each survey already represents
-- one floor plan, so ground control points and the resulting real-world
-- corner coordinates live directly on the survey row.
--
-- geo_points: the ground control points a person places — pairs of
--   { id, px, py, lat, lng } where px/py are floor-plan pixel coords
--   (same space as device x/y) and lat/lng are the matching point on
--   the satellite map.
-- geo_corners: the computed real-world position of the floor plan
--   image's three reference corners (top-left, top-right, bottom-left),
--   derived from geo_points — stored so the overlay can render
--   instantly on load without recomputing the fit every time.
-- geo_opacity: last-used overlay transparency, purely a UI convenience.

alter table surveys add column if not exists geo_points jsonb default '[]';
alter table surveys add column if not exists geo_corners jsonb;
alter table surveys add column if not exists geo_opacity numeric default 0.7;

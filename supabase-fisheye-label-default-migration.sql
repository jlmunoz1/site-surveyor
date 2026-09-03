-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
-- Requires supabase-hidden-labels-migration.sql to have already run.
--
-- Makes "Reolink Fisheye" labels hidden by default, since fisheye
-- cameras are usually placed densely enough that the labels clutter
-- the floor plan more than they help.

-- New surveys created from now on start with fisheye labels hidden.
alter table surveys alter column hidden_label_types set default '["reolink-fe"]';

-- Backfill: only touches surveys that have NEVER used this toggle at
-- all (still sitting at the empty-array factory default) — if you've
-- already customized this setting on a survey (even just to hide a
-- different device type), this leaves it alone rather than silently
-- overwriting your choice.
update surveys
set hidden_label_types = '["reolink-fe"]'
where hidden_label_types = '[]'::jsonb or hidden_label_types is null;

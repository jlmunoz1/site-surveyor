-- Run this in SITE SURVEYOR's Supabase SQL Editor.
--
-- Adds non-destructive floor plan cropping. The crop is stored as a window
-- { x, y, w, h } in the floor plan's own pixel space - the same space device
-- positions, cables, markup and georeference points already use - so
-- cropping never moves or rewrites any of that, and the original floor plan
-- file is never touched. NULL means "no crop" (show the whole sheet).

alter table surveys add column if not exists floor_plan_crop jsonb;

-- Make the new column visible to the API straight away.
notify pgrst, 'reload schema';

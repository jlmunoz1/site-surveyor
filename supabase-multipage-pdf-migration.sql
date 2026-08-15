-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
-- Lets a survey point to a specific page within a multi-page floor plan
-- PDF (e.g. a 3-floor PDF gets 3 surveys, each rendering a different page
-- of the same uploaded file).

alter table surveys add column if not exists floor_plan_page integer default 1;

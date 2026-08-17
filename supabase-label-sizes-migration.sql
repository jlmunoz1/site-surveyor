-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
-- Lets label font size be controlled independently from icon size —
-- previously label size was just a multiple of icon size, and labels
-- disappeared entirely below a certain icon size.

alter table surveys add column if not exists label_sizes jsonb;

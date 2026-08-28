-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
--
-- Lets labels be hidden per device type (e.g. hide "Reolink Fisheye"
-- labels specifically, while Dome/Bullet camera labels stay visible) —
-- stores which dtypes currently have their labels hidden, following the
-- same jsonb-column pattern as icon_sizes/label_sizes.

alter table surveys add column if not exists hidden_label_types jsonb default '[]';

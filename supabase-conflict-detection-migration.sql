-- Run this in SITE SURVEYOR's Supabase (project ref gtkviienagiokpijvrgz).
--
-- Supports the new "someone else changed this" conflict banner in the
-- survey editor. `updated_at` already existed and is used as the
-- optimistic-concurrency token (see saveSurvey in src/lib/supabase.js).
-- `updated_by` is new and is purely informational — it lets the banner
-- say who saved the conflicting change, instead of just "someone".
--
-- Nullable and backfilled as NULL for existing rows on purpose: we don't
-- know who made past edits, and the app already handles a missing name
-- by falling back to "another user".

alter table surveys add column if not exists updated_by uuid references auth.users(id) on delete set null;

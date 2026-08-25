-- Run this in Supabase's SQL editor and check the three results below.

-- 1) Did the "updated_by" migration actually run?
--    Expect to see updated_by in the list.
select column_name
from information_schema.columns
where table_name = 'surveys';

-- 2) What UPDATE policy is currently active on surveys?
--    If this still says "Owners update their own surveys" (checking only
--    auth.uid() = user_id), the team-update-access migration hasn't run
--    yet — that alone would explain this, admin or not, since the old
--    policy never checked is_admin for UPDATE at all.
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'surveys' and cmd = 'UPDATE';

-- 3) Is your own profile actually flagged as admin?
--    Replace with the email you log into the app with.
select id, email, is_admin, access_expires_at
from profiles
where email = 'you@company.com';

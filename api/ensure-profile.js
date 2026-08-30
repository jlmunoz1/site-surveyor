// Vercel serverless function. Self-heals a missing `profiles` row for
// the calling user. Under normal conditions, handle_new_user() (a
// Postgres trigger on auth.users) creates this automatically at
// signup — but that trigger was observed to silently not fire for at
// least one invited-via-email account, leaving a real, logged-in
// auth.users account with no matching profile row and, as a result, a
// permanently blank dashboard with no way for that person to recover
// on their own (see chat history for the specific incident).
//
// Uses Site Surveyor's own service_role key (bypasses RLS, needed to
// read project_members and insert into profiles regardless of the
// caller's own row not existing yet — a chicken-and-egg problem
// client-side RLS can't solve on its own). Identity is verified from
// the access token itself, not from anything the client claims, so
// this can only ever create/check a profile for the actual caller.
const { createClient } = require('@supabase/supabase-js')

const SITE_SURVEYOR_URL = 'https://gtkviienagiokpijvrgz.supabase.co'

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const serviceKey = process.env.SITE_SURVEYOR_SERVICE_ROLE_KEY
  if (!serviceKey) {
    res.status(500).json({ error: 'Server is missing SITE_SURVEYOR_SERVICE_ROLE_KEY' })
    return
  }

  const { accessToken } = req.body || {}
  if (!accessToken || typeof accessToken !== 'string') {
    res.status(400).json({ error: 'An access token is required' })
    return
  }

  try {
    const admin = createClient(SITE_SURVEYOR_URL, serviceKey)

    const { data: userData, error: userError } = await admin.auth.getUser(accessToken)
    if (userError || !userData?.user) {
      res.status(401).json({ error: 'Invalid or expired session' })
      return
    }
    const authUser = userData.user

    const { data: existing, error: existingError } = await admin
      .from('profiles').select('id').eq('id', authUser.id).maybeSingle()
    if (existingError) {
      res.status(500).json({ error: existingError.message })
      return
    }
    if (existing) {
      res.status(200).json({ created: false })
      return
    }

    // Mirrors handle_new_user()'s own logic — flags the new profile as
    // a contractor if this email already has a pending project invite,
    // exactly like the trigger is supposed to do at signup time.
    const { data: invite } = await admin
      .from('project_members').select('id').ilike('email', authUser.email).limit(1).maybeSingle()

    const { error: insertError } = await admin.from('profiles').insert({
      id: authUser.id,
      email: authUser.email,
      full_name: authUser.user_metadata?.full_name || null,
      is_contractor: !!invite,
    })
    if (insertError) {
      res.status(500).json({ error: insertError.message })
      return
    }
    res.status(200).json({ created: true })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error ensuring profile' })
  }
}

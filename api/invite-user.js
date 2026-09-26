// Vercel serverless function. Sends an actual invite email using
// Supabase's built-in admin invite system — the project_members table
// alone only grants access silently once someone signs up; it never
// notified anyone. This uses Site Surveyor's own service_role key
// (distinct from Port Mapper's), read only server-side, never exposed
// to the browser.
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

  const { email, projectName } = req.body || {}
  if (!email || typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'An email is required' })
    return
  }

  try {
    const admin = createClient(SITE_SURVEYOR_URL, serviceKey)
    const redirectTo = `https://site-surveyor.vercel.app/reset-password`
    const { error } = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
      redirectTo,
      data: projectName ? { invited_to_project: projectName } : undefined,
    })

    if (error) {
      // Someone who already has an account can't be "invited" again via
      // this API — that's fine, they can already log in normally, so
      // treat it as a non-error rather than surfacing it as a failure.
      const alreadyRegistered = /already been registered|already exists|already registered/i.test(error.message || '')
      if (alreadyRegistered) {
        res.status(200).json({ sent: false, reason: 'already_has_account' })
        return
      }
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ sent: true })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error sending invite email' })
  }
}

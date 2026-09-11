// Vercel serverless function. Fully deletes a user — removes the
// auth.users row (profiles cascades automatically via its FK). Used
// by /admin to clean up accounts, including stale/broken ones left
// over from before the signup trigger was removed.
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

  const { accessToken, targetUserId } = req.body || {}
  if (!accessToken || !targetUserId) {
    res.status(400).json({ error: 'accessToken and targetUserId are required' })
    return
  }

  try {
    const admin = createClient(SITE_SURVEYOR_URL, serviceKey)

    const { data: callerData, error: callerError } = await admin.auth.getUser(accessToken)
    if (callerError || !callerData?.user) {
      res.status(401).json({ error: 'Invalid or expired session' })
      return
    }
    const { data: callerProfile } = await admin
      .from('profiles').select('is_admin').eq('id', callerData.user.id).maybeSingle()
    if (!callerProfile?.is_admin) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    if (targetUserId === callerData.user.id) {
      res.status(400).json({ error: "You can't delete your own account from here" })
      return
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId)
    if (deleteError) {
      res.status(500).json({ error: deleteError.message })
      return
    }

    res.status(200).json({ deleted: true })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error deleting user' })
  }
}

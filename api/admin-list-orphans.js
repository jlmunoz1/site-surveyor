// Vercel serverless function. The /admin Users table is driven by the
// `profiles` table, not auth.users directly — so any account that
// exists in auth.users but never got a matching profiles row (broken
// invites, partial signups from before the fragile trigger was
// removed, etc.) is invisible there even though it's a real account
// sitting in the database. This surfaces those orphans specifically so
// they can be finished (profile created) or deleted outright.
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
  if (!accessToken) {
    res.status(400).json({ error: 'accessToken is required' })
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

    const { data: authList, error: listError } = await admin.auth.admin.listUsers({ perPage: 500 })
    if (listError) {
      res.status(500).json({ error: listError.message })
      return
    }
    const { data: profileRows, error: profileError } = await admin.from('profiles').select('id')
    if (profileError) {
      res.status(500).json({ error: profileError.message })
      return
    }
    const profileIds = new Set((profileRows || []).map(p => p.id))

    const orphans = (authList?.users || [])
      .filter(u => !profileIds.has(u.id))
      .map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        confirmed_at: u.confirmed_at || u.email_confirmed_at || null,
        last_sign_in_at: u.last_sign_in_at,
      }))

    res.status(200).json({ orphans })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error listing orphaned accounts' })
  }
}

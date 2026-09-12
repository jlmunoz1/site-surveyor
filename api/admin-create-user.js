// Vercel serverless function. Lets an admin create a user directly
// from /admin — explicit role (staff/contractor) chosen up front,
// rather than inferring it from project_members at signup time (the
// trigger-based approach that kept breaking). The account still gets
// a real "set your password" email via inviteUserByEmail, delivered
// through the custom SMTP already configured in Supabase, so
// deliverability isn't affected by removing the trigger.
//
// The profile row is created directly here (with the chosen role),
// not left to the ensure-profile self-heal path — that path only
// fires on first login and defaults role from project_members alone;
// this lets an admin set it deterministically at creation time.
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

  const { accessToken, email, fullName, role, projectIds, targetUserId } = req.body || {}
  if (!accessToken || !email || typeof email !== 'string') {
    res.status(400).json({ error: 'accessToken and email are required' })
    return
  }
  const isContractor = role === 'contractor'

  try {
    const admin = createClient(SITE_SURVEYOR_URL, serviceKey)

    // Verify the CALLER is a real, currently-admin user — never trust
    // a client-supplied "I'm an admin" claim for something this
    // sensitive.
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

    const cleanEmail = email.trim().toLowerCase()
    let newUserId = targetUserId

    if (!newUserId) {
      // Normal path — create a brand new account and email them a
      // "set your password" link through the configured SMTP.
      const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
        redirectTo: 'https://cabldex.com/reset-password',
        data: fullName ? { full_name: fullName } : undefined,
      })
      if (inviteError) {
        res.status(500).json({ error: inviteError.message })
        return
      }
      newUserId = inviteData?.user?.id
      if (!newUserId) {
        res.status(500).json({ error: 'User was invited but no user id was returned' })
        return
      }
    }
    // else: targetUserId path — the auth account already exists (an
    // orphan with no profile row), so just attach a profile to it
    // with the chosen role, no new invite sent.

    const { error: profileError } = await admin.from('profiles').upsert({
      id: newUserId,
      email: cleanEmail,
      full_name: fullName || null,
      is_contractor: isContractor,
    })
    if (profileError) {
      res.status(500).json({ error: `User created, but profile setup failed: ${profileError.message}` })
      return
    }

    if (isContractor && Array.isArray(projectIds) && projectIds.length) {
      const rows = projectIds.map(projectId => ({ project_id: projectId, email: cleanEmail, invited_by: callerData.user.id }))
      const { error: membersError } = await admin.from('project_members').insert(rows)
      if (membersError) {
        // Non-fatal — the account and profile are already good; just
        // report it so the admin knows to add project access manually.
        res.status(200).json({ created: true, userId: newUserId, warning: `Account created, but project invites failed: ${membersError.message}` })
        return
      }
    }

    res.status(200).json({ created: true, userId: newUserId })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error creating user' })
  }
}

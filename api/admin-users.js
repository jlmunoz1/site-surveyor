// Vercel serverless function behind the Admin page's "Invite user" and
// "Edit user" dialogs.
//
// Why this needs a server function at all: creating an account, and changing
// someone's sign-in email, are auth-level operations that the browser's
// normal (RLS-limited) key can't do. This uses Site Surveyor's own
// service_role key, read only server-side, never exposed to the browser.
//
// Because that key bypasses every security rule, the FIRST thing this does
// is prove who is calling - from the access token itself, not from anything
// the request claims - and refuse anyone who isn't an admin. Without that
// check, anyone who found this URL could create or modify accounts.
const { createClient } = require('@supabase/supabase-js')

const SITE_SURVEYOR_URL = 'https://gtkviienagiokpijvrgz.supabase.co'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// undefined / '' / null all mean "no limit"; anything else must be a real date.
function parseExpiry(value) {
  if (value === undefined || value === null || value === '') return { value: null }
  const d = new Date(value)
  if (isNaN(d.getTime())) return { error: 'That access-end date is not valid' }
  return { value: d.toISOString() }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const serviceKey = process.env.SITE_SURVEYOR_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Server is missing SITE_SURVEYOR_SERVICE_ROLE_KEY' })

  const body = req.body || {}
  const { accessToken, action } = body
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'An access token is required' })
  }

  try {
    const admin = createClient(SITE_SURVEYOR_URL, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 1) Who is calling?
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken)
    if (userError || !userData?.user) return res.status(401).json({ error: 'Invalid or expired session' })
    const caller = userData.user

    // 2) Are they an admin?
    const { data: callerProfile, error: callerErr } = await admin
      .from('profiles').select('is_admin').eq('id', caller.id).maybeSingle()
    if (callerErr) return res.status(500).json({ error: callerErr.message })
    if (!callerProfile?.is_admin) return res.status(403).json({ error: 'Only admins can manage users' })

    if (action === 'invite') return await inviteUser(admin, req, res, body)
    if (action === 'update') return await updateUser(admin, res, body, caller)
    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown error managing users' })
  }
}

// ── Invite ───────────────────────────────────────────────────────────────
async function inviteUser(admin, req, res, body) {
  const email = String(body.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' })

  const fullName = String(body.fullName || '').trim().slice(0, 120)
  const isAdmin = !!body.isAdmin
  // An admin always sees the whole org, so "scoped" doesn't apply to them.
  const isContractor = isAdmin ? false : !!body.isContractor

  const exp = parseExpiry(body.accessExpiresAt)
  if (exp.error) return res.status(400).json({ error: exp.error })
  if (exp.value && new Date(exp.value) <= new Date()) {
    return res.status(400).json({ error: 'The access-end date is already in the past' })
  }

  // Send them back to whichever site the admin is on (so it works on the
  // custom domain as well as the vercel.app one).
  const origin = req.headers.origin
  const base = origin && /^https?:\/\/[^\s/]+$/.test(origin) ? origin : 'https://cabldex.com'

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${base}/reset-password`,
    data: fullName ? { full_name: fullName } : undefined,
  })
  if (error) {
    // Someone who already has an account can't be invited again - tell the
    // admin to use Edit on their existing row instead.
    if (/already been registered|already exists|already registered/i.test(error.message || '')) {
      return res.status(200).json({ ok: false, reason: 'already_exists' })
    }
    return res.status(500).json({ error: error.message })
  }

  // Create/refresh their profile row right away with the role, scope and
  // access limit the admin chose, so those apply from their very first
  // login (and so they show up in the Admin list immediately) rather than
  // waiting for them to sign in first.
  let warning = null
  const newUser = data?.user
  if (newUser?.id) {
    const { error: profileError } = await admin.from('profiles').upsert({
      id: newUser.id,
      email,
      full_name: fullName || null,
      is_admin: isAdmin,
      is_contractor: isContractor,
      access_expires_at: exp.value,
    }, { onConflict: 'id' })
    if (profileError) {
      warning = `The invite email was sent, but saving their role and access settings failed (${profileError.message}). Open Edit on their row to set them.`
    }
  }
  return res.status(200).json({ ok: true, sent: true, warning })
}

// ── Edit ─────────────────────────────────────────────────────────────────
async function updateUser(admin, res, body, caller) {
  const userId = body.userId
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'A user is required' })

  const { data: target, error: targetErr } = await admin
    .from('profiles').select('*').eq('id', userId).maybeSingle()
  if (targetErr) return res.status(500).json({ error: targetErr.message })
  if (!target) return res.status(404).json({ error: 'That user was not found' })

  const isSelf = userId === caller.id
  const patch = {}
  let warning = null

  if (body.fullName !== undefined) {
    patch.full_name = String(body.fullName || '').trim().slice(0, 120) || null
  }

  // You can rename yourself, but not change your own role, scope, access
  // limit, or sign-in email from here - that's how an admin accidentally
  // locks themselves out. (Same rule the toggles on the Admin page follow.)
  if (!isSelf) {
    if (body.isAdmin !== undefined) patch.is_admin = !!body.isAdmin
    if (body.isContractor !== undefined) patch.is_contractor = !!body.isContractor
    if (patch.is_admin === true) patch.is_contractor = false
    if (body.accessExpiresAt !== undefined) {
      const exp = parseExpiry(body.accessExpiresAt)
      if (exp.error) return res.status(400).json({ error: exp.error })
      patch.access_expires_at = exp.value
    }
  }

  // Email: change the real sign-in address, not just the display copy.
  const oldEmail = String(target.email || '').toLowerCase()
  const newEmail = body.email !== undefined ? String(body.email || '').trim().toLowerCase() : ''
  if (newEmail && newEmail !== oldEmail) {
    if (isSelf) return res.status(400).json({ error: "You can't change your own sign-in email from here" })
    if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: 'Enter a valid email address' })

    const { error: emailErr } = await admin.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true })
    if (emailErr) return res.status(400).json({ error: emailErr.message })
    patch.email = newEmail

    // Project access for invited people is matched BY EMAIL (project_members
    // stores the address, not a user id). If we only changed the account,
    // they'd silently lose every project they'd been invited to - so carry
    // those invites over to the new address.
    try {
      const escaped = oldEmail.replace(/[\\%_]/g, m => '\\' + m)
      const { data: rows } = await admin.from('project_members').select('id, email').ilike('email', escaped)
      for (const row of (rows || []).filter(r => String(r.email).toLowerCase() === oldEmail)) {
        const { error: moveErr } = await admin.from('project_members').update({ email: newEmail }).eq('id', row.id)
        // The new address is already a member of that project - drop the
        // old duplicate rather than fail.
        if (moveErr) await admin.from('project_members').delete().eq('id', row.id)
      }
    } catch (e) {
      warning = 'Their sign-in email was changed, but moving their project invites to the new address failed. Re-share any projects they lost.'
    }
  }

  // Keep the name on the auth account in step with the profile (merge, so
  // anything else stored in the metadata survives).
  if (patch.full_name !== undefined) {
    try {
      const { data: authData } = await admin.auth.admin.getUserById(userId)
      const meta = { ...(authData?.user?.user_metadata || {}), full_name: patch.full_name }
      await admin.auth.admin.updateUserById(userId, { user_metadata: meta })
    } catch (e) { /* the profile name is what the app displays; not worth failing the save */ }
  }

  if (Object.keys(patch).length === 0) return res.status(200).json({ ok: true, profile: target, warning })

  const { data: updated, error: updErr } = await admin
    .from('profiles').update(patch).eq('id', userId).select().maybeSingle()
  if (updErr) {
    return res.status(500).json({
      error: patch.email
        ? `Their sign-in email was changed, but saving the rest failed: ${updErr.message}`
        : updErr.message,
    })
  }
  return res.status(200).json({ ok: true, profile: updated, warning })
}

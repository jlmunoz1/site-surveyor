import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
)

// ── Auth ────────────────────────────────────────────────────────────────
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error }
}

export async function signUp(email, password, fullName) {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  return { error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export async function sendPasswordReset(email) {
  const redirectTo = `${window.location.origin}/reset-password`
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  return { error }
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  return { error }
}

// ── Surveys ─────────────────────────────────────────────────────────────
// Returns every survey visible to the team (RLS allows any authenticated
// user to view all rows; only the owner can edit/delete their own).
// Ownership (survey.user_id) is used client-side to split "My" vs "Team".
export async function getSurveys() {
  return supabase
    .from('surveys')
    .select('*')
    .order('updated_at', { ascending: false })
}

export async function getSurvey(id) {
  return supabase.from('surveys').select('*').eq('id', id).single()
}

export async function getSurveyByToken(token) {
  const { data: tokenRow, error: tokenError } = await supabase
    .from('share_tokens')
    .select('survey_id')
    .eq('token', token)
    .single()
  if (tokenError || !tokenRow) {
    return { data: null, error: tokenError || new Error('Invalid or expired share link') }
  }
  return supabase.from('surveys').select('*').eq('id', tokenRow.survey_id).single()
}

export async function createSurvey(userId, name, projectId = null) {
  return supabase
    .from('surveys')
    .insert({ user_id: userId, name, project_id: projectId })
    .select()
    .single()
}

export async function saveSurvey(id, updates) {
  return supabase
    .from('surveys')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
}

export async function deleteSurvey(id) {
  const { error } = await supabase.from('surveys').delete().eq('id', id)
  return { error }
}

// ── Projects ────────────────────────────────────────────────────────────
export async function getProjects() {
  return supabase.from('projects').select('*').order('name')
}

export async function getProject(id) {
  return supabase.from('projects').select('*').eq('id', id).single()
}

export async function createProject(userId, name) {
  return supabase.from('projects').insert({ user_id: userId, name }).select().single()
}

export async function deleteProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  return { error }
}

// ── Project invitations ─────────────────────────────────────────────────
export async function getProjectMembers(projectId) {
  return supabase.from('project_members').select('*').eq('project_id', projectId).order('created_at')
}

export async function inviteToProject(projectId, email, invitedBy) {
  return supabase.from('project_members').insert({ project_id: projectId, email: email.trim().toLowerCase(), invited_by: invitedBy }).select().single()
}

export async function removeProjectMember(id) {
  const { error } = await supabase.from('project_members').delete().eq('id', id)
  return { error }
}

export async function setProjectPortMapperSiteId(projectId, siteId) {
  return supabase.from('projects').update({ port_mapper_site_id: siteId }).eq('id', projectId)
}

// Best-effort mirror of a newly created project into Port Mapper's
// "sites" table, via our own serverless function (which holds Port
// Mapper's service key). Failure here should never block creating the
// project in Site Surveyor itself — callers should treat this as
// optional and just surface a soft warning if it fails.
export async function syncProjectToPortMapper(name) {
  try {
    const res = await fetch('/api/create-port-mapper-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error || 'Failed to sync to Port Mapper' }
    return { site: data.site, error: null }
  } catch (err) {
    return { error: err.message || 'Failed to reach Port Mapper sync' }
  }
}

// Best-effort creation of a rack in Port Mapper for a given site, e.g.
// when an MDF/IDF/switch is placed in Site Surveyor. Same fire-and-forget
// pattern as syncProjectToPortMapper — never blocks the caller.
export async function createPortMapperRack(siteId, name, { uSize, rackType } = {}) {
  try {
    const res = await fetch('/api/create-port-mapper-rack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, name, uSize, rackType }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error || 'Failed to create rack in Port Mapper' }
    return { rack: data.rack, error: null }
  } catch (err) {
    return { error: err.message || 'Failed to reach Port Mapper rack sync' }
  }
}

// Reads back the equipment (patch panels, switches, UPS, etc.) already
// placed inside a given Port Mapper rack, so it can be shown read-only
// in Site Surveyor's Properties panel.
export async function getPortMapperRackDevices(rackId) {
  try {
    const res = await fetch(`/api/get-port-mapper-rack-devices?rackId=${encodeURIComponent(rackId)}`)
    const data = await res.json()
    if (!res.ok) return { error: data.error || 'Failed to load rack equipment' }
    return { devices: data.devices || [], error: null }
  } catch (err) {
    return { error: err.message || 'Failed to reach Port Mapper' }
  }
}

// Renames an already-created rack in Port Mapper — used when someone
// edits the "Rack / site ID" field after the rack was auto-created, so
// Port Mapper's naming convention is respected instead of the generic
// device label it started with.
export async function updatePortMapperRackName(portMapperRackId, name) {
  try {
    const res = await fetch('/api/update-port-mapper-rack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rackId: portMapperRackId, name }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error || 'Failed to rename rack in Port Mapper' }
    return { rack: data.rack, error: null }
  } catch (err) {
    return { error: err.message || 'Failed to reach Port Mapper' }
  }
}

// ── Profiles (for "created by" display + admin) ────────────────────────
export async function getProfiles() {
  return supabase.from('profiles').select('*')
}

export async function getMyProfile(userId) {
  return supabase.from('profiles').select('*').eq('id', userId).single()
}

export async function setUserAdmin(id, isAdmin) {
  return supabase.from('profiles').update({ is_admin: isAdmin }).eq('id', id)
}

export async function setUserAccessExpiration(id, expiresAt) {
  return supabase.from('profiles').update({ access_expires_at: expiresAt }).eq('id', id)
}

// ── Floor plan storage ──────────────────────────────────────────────────
export async function uploadFloorPlan(surveyId, file) {
  const ext = file.name.split('.').pop()
  const path = `${surveyId}/${Date.now()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('floor-plans')
    .upload(path, file, { upsert: true })
  if (uploadError) return { url: null, error: uploadError }
  const { data } = supabase.storage.from('floor-plans').getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}

// Device photos reuse the same public "floor-plans" bucket, just under a
// devices/ subfolder — avoids needing a second bucket + storage policies.
export async function uploadDevicePhoto(surveyId, deviceId, file) {
  const ext = file.name.split('.').pop()
  const path = `${surveyId}/devices/${deviceId}-${Date.now()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('floor-plans')
    .upload(path, file, { upsert: true })
  if (uploadError) return { url: null, error: uploadError }
  const { data } = supabase.storage.from('floor-plans').getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}

// ── Share links ─────────────────────────────────────────────────────────
export async function createShareToken(surveyId) {
  const { data: existing } = await supabase
    .from('share_tokens')
    .select('token')
    .eq('survey_id', surveyId)
    .limit(1)
    .maybeSingle()
  if (existing) return { token: existing.token, error: null }

  const token = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, '')
  const { error } = await supabase.from('share_tokens').insert({ survey_id: surveyId, token })
  return { token: error ? null : token, error }
}

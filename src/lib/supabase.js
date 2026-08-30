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

// Saves survey changes with optional optimistic-concurrency checking.
//
// If `expectedUpdatedAt` is passed, the update is scoped to rows that
// still have that exact updated_at — i.e. "only save if nobody else has
// saved since I loaded this". If the row has moved on (someone else's
// save landed first), the .eq() match fails, zero rows are updated, and
// we come back with `conflict: true` plus the current server copy of the
// survey so the caller can show a "someone else changed this" banner
// instead of silently overwriting it on the next autosave tick.
//
// Omitting `expectedUpdatedAt` skips the check entirely (existing
// behavior) — used for an explicit "overwrite anyway" resolution, or for
// smaller one-off field updates where a conflict is far less costly.
export async function saveSurvey(id, updates, { expectedUpdatedAt = null, updatedBy = null } = {}) {
  let query = supabase
    .from('surveys')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
      ...(updatedBy ? { updated_by: updatedBy } : {}),
    })
    .eq('id', id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query.select('updated_at')
  if (error) return { data: null, error, conflict: false }

  // Zero rows updated always means the write didn't actually happen —
  // either someone else's save landed first (when we scoped to
  // expectedUpdatedAt), or RLS silently blocked it (e.g. no update
  // permission on this survey), or the row no longer exists. Postgres/
  // PostgREST don't raise an error for an update that matches nothing,
  // so `!error` alone is not proof of success — we have to check the
  // returned row count ourselves.
  if (!data || data.length === 0) {
    if (expectedUpdatedAt) {
      const { data: latest, error: latestError } = await getSurvey(id)
      return { data: null, error: latestError, conflict: true, latest }
    }
    return {
      data: null,
      error: new Error("Save didn't take effect — you may not have permission to edit this survey, or it no longer exists."),
      conflict: false,
    }
  }


  return { data, error: null, conflict: false }
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

export async function getEnterprises() {
  return supabase.from('enterprises').select('*').order('name')
}

export async function getEnterprise(id) {
  return supabase.from('enterprises').select('*').eq('id', id).single()
}

export async function createEnterprise(userId, name) {
  return supabase.from('enterprises').insert({ user_id: userId, name }).select().single()
}

// Same defensive zero-row check as renameProject/updateProjectAddress.
export async function renameEnterprise(id, name) {
  const { data, error } = await supabase.from('enterprises').update({ name }).eq('id', id).select('id')
  if (error) return { data: null, error }
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Rename didn't take effect — you may not have permission to edit this enterprise.") }
  }
  return { data, error: null }
}

// Deleting an enterprise doesn't delete its projects — the FK is
// ON DELETE SET NULL, so they just fall back into "Unassigned."
export async function deleteEnterprise(id) {
  return supabase.from('enterprises').delete().eq('id', id)
}

// Folds a duplicate enterprise into another: every project currently
// filed under `fromId` gets reassigned to `toId`, then the now-empty
// `fromId` enterprise is deleted. Used by the admin "merge duplicates"
// flow — reassignment happens first and is checked before the delete
// is attempted, so a partial failure never silently loses projects.
export async function mergeEnterprises(fromId, toId) {
  if (fromId === toId) return { error: new Error('Cannot merge an enterprise into itself') }
  const { error: reassignError } = await supabase
    .from('projects')
    .update({ enterprise_id: toId })
    .eq('enterprise_id', fromId)
  if (reassignError) return { error: reassignError }
  const { error: deleteError } = await supabase.from('enterprises').delete().eq('id', fromId)
  if (deleteError) return { error: deleteError }
  return { error: null }
}

// Assigns (or unassigns, if enterpriseId is null) a project to an
// enterprise. Same zero-row check pattern as the other project writes.
export async function setProjectEnterprise(projectId, enterpriseId) {
  const { data, error } = await supabase
    .from('projects')
    .update({ enterprise_id: enterpriseId })
    .eq('id', projectId)
    .select('id')
  if (error) return { data: null, error }
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Couldn't move this project — you may not have permission to edit it.") }
  }
  return { data, error: null }
}

// Renames a project. Same defensive pattern as saveSurvey: Postgres RLS
// silently matches zero rows on a blocked update rather than raising an
// error, so `!error` alone isn't proof the rename actually happened —
// we check the row count came back before reporting success.
export async function renameProject(id, name) {
  const { data, error } = await supabase.from('projects').update({ name }).eq('id', id).select('id')
  if (error) return { data: null, error }
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Rename didn't take effect — you may not have permission to edit this project.") }
  }
  return { data, error: null }
}

// Sets a project's site address and its geocoded lat/lng (or clears
// them if address is empty). Same zero-row check as renameProject.
export async function updateProjectAddress(id, address, lat, lng) {
  const { data, error } = await supabase
    .from('projects')
    .update({ address: address || null, address_lat: lat ?? null, address_lng: lng ?? null })
    .eq('id', id)
    .select('id')
  if (error) return { data: null, error }
  if (!data || data.length === 0) {
    return { data: null, error: new Error("Address update didn't take effect — you may not have permission to edit this project.") }
  }
  return { data, error: null }
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

// Sends an actual invite email (via Supabase's built-in admin invite
// system) telling someone they've been given access — the
// project_members row alone only grants access silently, it never
// notifies anyone on its own.
export async function sendProjectInviteEmail(email, projectName) {
  try {
    const res = await fetch('/api/invite-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, projectName }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error || 'Failed to send invite email' }
    return { sent: data.sent, reason: data.reason, error: null }
  } catch (err) {
    return { error: err.message || 'Failed to reach invite email service' }
  }
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

// Used to attribute a conflicting save to a name in the "someone else
// changed this" banner (survey.updated_by -> profiles.id).
export async function getProfileById(id) {
  return supabase.from('profiles').select('*').eq('id', id).maybeSingle()
}

export async function setUserAdmin(id, isAdmin) {
  return supabase.from('profiles').update({ is_admin: isAdmin }).eq('id', id)
}

// Controls whether a user gets org-wide "staff" visibility or is
// scoped down to only projects they own or were invited to — separate
// from access_expires_at, which controls whether their access works AT
// ALL rather than how much of the org it covers. New accounts that
// sign up in response to a project invite are auto-flagged as a
// contractor (see handle_new_user in supabase-contractor-scope-migration.sql);
// this lets an admin override that either direction.
export async function setUserContractor(id, isContractor) {
  return supabase.from('profiles').update({ is_contractor: isContractor }).eq('id', id)
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

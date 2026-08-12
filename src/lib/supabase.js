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

// ── Surveys ─────────────────────────────────────────────────────────────
export async function getSurveys(userId) {
  return supabase
    .from('surveys')
    .select('*')
    .eq('user_id', userId)
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

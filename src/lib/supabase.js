import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Auth helpers
export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  })
  return { data, error }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { data, error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Survey helpers
export async function createSurvey(userId, name, projectId = null) {
  const { data, error } = await supabase
    .from('surveys')
    .insert({ user_id: userId, name, project_id: projectId, devices: [], cables: [], svg_markup: '', px_per_ft: 4, icon_size: 38, floor_plan_rotation: 0 })
    .select()
    .single()
  return { data, error }
}

export async function getSurveys(userId) {
  const { data, error } = await supabase
    .from('surveys')
    .select('id, name, created_at, updated_at, floor_plan_url')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  return { data, error }
}

export async function getSurvey(id) {
  const { data, error } = await supabase
    .from('surveys')
    .select('*')
    .eq('id', id)
    .single()
  return { data, error }
}

export async function saveSurvey(id, updates) {
  const { data, error } = await supabase
    .from('surveys')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  return { data, error }
}

export async function deleteSurvey(id) {
  const { error } = await supabase.from('surveys').delete().eq('id', id)
  return { error }
}

export async function uploadFloorPlan(surveyId, file) {
  const ext = file.name.split('.').pop()
  const path = `${surveyId}/floor-plan.${ext}`
  const { error } = await supabase.storage
    .from('floor-plans')
    .upload(path, file, { upsert: true })
  if (error) return { url: null, error }
  const { data: { publicUrl } } = supabase.storage.from('floor-plans').getPublicUrl(path)
  return { url: publicUrl, error: null }
}

// Share tokens — allow read-only + redline access without login
export async function createShareToken(surveyId) {
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const { data, error } = await supabase
    .from('share_tokens')
    .insert({ survey_id: surveyId, token })
    .select()
    .single()
  return { token: data?.token, error }
}

export async function getSurveyByToken(token) {
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('share_tokens')
    .select('survey_id')
    .eq('token', token)
    .single()
  if (tokenErr) return { data: null, error: tokenErr }
  return getSurvey(tokenRow.survey_id)
}

import { useState, useEffect, createContext, useContext } from 'react'
import { supabase, getMyProfile, ensureMyProfile } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load the current user's own profile row (has is_admin on it) whenever
  // the logged-in user changes. A profile row should always already
  // exist by this point (created by a database trigger at signup) —
  // but that trigger has been observed to silently not fire for at
  // least one invited-via-email account, leaving a real, logged-in
  // person with nothing to load here and a permanently blank
  // dashboard. Self-heal it here rather than leaving them stuck with
  // no way to recover on their own.
  useEffect(() => {
    if (!user) { setProfile(null); return }
    let cancelled = false
    getMyProfile(user.id).then(async ({ data }) => {
      if (cancelled) return
      if (data) { setProfile(data); return }
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (session?.access_token) {
        await ensureMyProfile(session.access_token)
        const { data: retried } = await getMyProfile(user.id)
        if (!cancelled) setProfile(retried || null)
      } else {
        setProfile(null)
      }
    })
    return () => { cancelled = true }
  }, [user])

  const isExpired = !!(profile?.access_expires_at && new Date(profile.access_expires_at) <= new Date())

  return (
    <AuthContext.Provider value={{ user, loading, profile, isAdmin: !!profile?.is_admin, isExpired }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

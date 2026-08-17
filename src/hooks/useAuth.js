import { useState, useEffect, createContext, useContext } from 'react'
import { supabase, getMyProfile } from '../lib/supabase'

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
  // the logged-in user changes.
  useEffect(() => {
    if (!user) { setProfile(null); return }
    getMyProfile(user.id).then(({ data }) => setProfile(data || null))
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

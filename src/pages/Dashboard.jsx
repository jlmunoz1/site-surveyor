import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getSurveys, createSurvey, deleteSurvey, signOut } from '../lib/supabase'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [surveys, setSurveys] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user) loadSurveys()
  }, [user])

  async function loadSurveys() {
    setLoading(true)
    const { data } = await getSurveys(user.id)
    setSurveys(data || [])
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    const { data, error } = await createSurvey(user.id, newName.trim())
    if (error) { setError(error.message); setCreating(false); return }
    navigate(`/survey/${data.id}`)
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    const { error } = await deleteSurvey(id)
    if (error) setError(error.message)
    else setSurveys(s => s.filter(x => x.id !== id))
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  const displayName = user?.user_metadata?.full_name || user?.email

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f6' }}>
      <nav style={{ background: '#fff', borderBottom: '0.5px solid #e0dfd8', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 28 28">
            <rect x="3" y="9" width="22" height="14" rx="3" fill="#3B6D1118" stroke="#3B6D11" strokeWidth="2"/>
            <line x1="14" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="2"/>
            <line x1="10" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="1.5"/>
            <line x1="18" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="1.5"/>
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a18' }}>Network Surveyor</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: '#666' }}>{displayName}</span>
          <button onClick={handleSignOut} style={ghostBtn}>Sign out</button>
        </div>
      </nav>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1a1a18', margin: 0 }}>Surveys</h1>
          <button onClick={() => setShowNew(true)} style={primaryBtn}>+ New survey</button>
        </div>

        {showNew && (
          <form onSubmit={handleCreate} style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Survey name (e.g. Acme Corp — 2nd Floor)"
              style={{ ...fieldInput, flex: 1 }}
              required
            />
            <button type="submit" disabled={creating} style={primaryBtn}>{creating ? 'Creating…' : 'Create'}</button>
            <button type="button" onClick={() => setShowNew(false)} style={ghostBtn}>Cancel</button>
          </form>
        )}

        {error && <p style={{ fontSize: 12, color: '#A32D2D', background: '#FCEBEB', padding: '8px 12px', borderRadius: 6, marginBottom: 16 }}>{error}</p>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>Loading surveys…</div>
        ) : surveys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 64, color: '#888' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" style={{ marginBottom: 12, opacity: 0.3 }}>
              <rect x="8" y="16" width="32" height="24" rx="4" fill="none" stroke="#888" strokeWidth="2"/>
              <line x1="24" y1="6" x2="24" y2="16" stroke="#888" strokeWidth="2"/>
              <line x1="18" y1="6" x2="24" y2="16" stroke="#888" strokeWidth="1.5"/>
              <line x1="30" y1="6" x2="24" y2="16" stroke="#888" strokeWidth="1.5"/>
            </svg>
            <p style={{ fontSize: 14, margin: 0 }}>No surveys yet — create your first one above.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {surveys.map(s => (
              <div key={s.id} style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: '#1a1a18' }}>{s.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#888' }}>
                    Updated {new Date(s.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {s.floor_plan_url && <span style={{ marginLeft: 8, color: '#1D9E75' }}>✓ Floor plan</span>}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => navigate(`/survey/${s.id}`)} style={primaryBtn}>Open</button>
                  <button onClick={() => handleDelete(s.id, s.name)} style={{ ...ghostBtn, color: '#A32D2D', borderColor: '#F09595' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const primaryBtn = {
  padding: '7px 14px', background: '#378ADD', color: '#fff', border: 'none',
  borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer'
}
const ghostBtn = {
  padding: '7px 14px', background: '#fff', color: '#444', border: '0.5px solid #ccc',
  borderRadius: 7, fontSize: 12, cursor: 'pointer'
}
const fieldInput = {
  padding: '8px 10px', fontSize: 13, border: '0.5px solid #ccc',
  borderRadius: 8, outline: 'none', background: '#fff', color: '#1a1a18'
}

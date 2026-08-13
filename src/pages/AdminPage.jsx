import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getProfiles, getSurveys, getProjects, setUserAdmin, signOut } from '../lib/supabase'

export default function AdminPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [stats, setStats] = useState({}) // id -> { surveys, projects }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: profData, error: profErr }, { data: survData }, { data: projData }] = await Promise.all([
      getProfiles(),
      getSurveys(),
      getProjects(),
    ])
    if (profErr) setError(profErr.message)
    const sortedUsers = (profData || []).slice().sort((a, b) =>
      new Date(a.created_at) - new Date(b.created_at)
    )
    setUsers(sortedUsers)
    const s = {}
    sortedUsers.forEach(u => {
      s[u.id] = {
        surveys: (survData || []).filter(x => x.user_id === u.id).length,
        projects: (projData || []).filter(x => x.user_id === u.id).length,
      }
    })
    setStats(s)
    setLoading(false)
  }

  async function toggleAdmin(u) {
    if (u.id === user.id) return // can't demote yourself from here
    setBusyId(u.id)
    const { error } = await setUserAdmin(u.id, !u.is_admin)
    if (error) setError(error.message)
    else setUsers(list => list.map(x => x.id === u.id ? { ...x, is_admin: !x.is_admin } : x))
    setBusyId(null)
  }

  async function handleSignOut() {
    await signOut(); navigate('/')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f6', fontFamily: 'system-ui, sans-serif' }}>
      <nav style={{ background: '#fff', borderBottom: '0.5px solid #e0dfd8', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 28 28">
            <rect x="3" y="9" width="22" height="14" rx="3" fill="#3B6D1118" stroke="#3B6D11" strokeWidth="2"/>
            <line x1="14" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="2"/>
            <line x1="10" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="1.5"/>
            <line x1="18" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="1.5"/>
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a18' }}>Network Surveyor</span>
          <span style={{ fontSize: 11, color: '#888', background: '#eeede7', padding: '3px 8px', borderRadius: 6, marginLeft: 4 }}>Admin</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => navigate('/dashboard')} style={ghostBtn}>Back to dashboard</button>
          <button onClick={handleSignOut} style={ghostBtn}>Sign out</button>
        </div>
      </nav>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1a1a18', margin: '0 0 4px' }}>Registered users</h1>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 24px' }}>
          {users.length} account{users.length !== 1 ? 's' : ''} — staff and contractors who have signed up.
        </p>

        {error && <p style={{ fontSize: 12, color: '#A32D2D', background: '#FCEBEB', padding: '8px 12px', borderRadius: 6, marginBottom: 16 }}>{error}</p>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr 110px 110px 110px 120px', gap: 8, padding: '10px 16px', background: '#f8f8f6', borderBottom: '0.5px solid #e0dfd8', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.3 }}>
              <span>Name</span>
              <span>Email</span>
              <span>Joined</span>
              <span>Surveys</span>
              <span>Projects</span>
              <span>Role</span>
            </div>
            {users.map(u => (
              <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr 110px 110px 110px 120px', gap: 8, padding: '12px 16px', borderBottom: '0.5px solid #f0efea', alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: '#1a1a18', fontWeight: 500 }}>
                  {u.full_name || '—'}{u.id === user.id && <span style={{ color: '#888', fontWeight: 400 }}> (you)</span>}
                </span>
                <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                <span style={{ color: '#aaa', fontSize: 12 }}>
                  {u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </span>
                <span style={{ color: '#666' }}>{stats[u.id]?.surveys ?? 0}</span>
                <span style={{ color: '#666' }}>{stats[u.id]?.projects ?? 0}</span>
                <button
                  onClick={() => toggleAdmin(u)}
                  disabled={u.id === user.id || busyId === u.id}
                  style={{
                    padding: '5px 10px', fontSize: 11, fontWeight: 500, borderRadius: 6, cursor: u.id === user.id ? 'default' : 'pointer',
                    border: u.is_admin ? '0.5px solid #AFA9EC' : '0.5px solid #ccc',
                    background: u.is_admin ? '#534AB714' : '#fff',
                    color: u.is_admin ? '#534AB7' : '#666',
                    opacity: u.id === user.id ? 0.5 : 1,
                  }}
                  title={u.id === user.id ? "You can't change your own role here" : ''}
                >
                  {u.is_admin ? 'Admin' : 'Make admin'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const ghostBtn = { padding: '6px 14px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 12, cursor: 'pointer' }

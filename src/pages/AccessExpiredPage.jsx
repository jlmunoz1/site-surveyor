import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { signOut } from '../lib/supabase'

export default function AccessExpiredPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut(); navigate('/')
  }

  const expiredDate = profile?.access_expires_at
    ? new Date(profile.access_expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f8f6' }}>
      <div style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 12, padding: '36px 40px', width: 380, textAlign: 'center' }}>
        <i className="ti ti-clock-x" style={{ fontSize: 40, color: '#E24B4A', display: 'block', marginBottom: 16 }} />
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#1a1a18', margin: '0 0 8px' }}>Access has expired</h1>
        <p style={{ fontSize: 13, color: '#666', margin: '0 0 4px', lineHeight: 1.5 }}>
          Your access to Network Surveyor {expiredDate ? `ended on ${expiredDate}` : 'has ended'}.
        </p>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 24px', lineHeight: 1.5 }}>
          If you still need access, ask an admin on your team to extend it.
        </p>
        <button onClick={handleSignOut} style={{
          padding: '10px 20px', background: '#378ADD', color: '#fff', border: 'none',
          borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer'
        }}>
          Sign out
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updatePassword } from '../lib/supabase'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setSuccess('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const { error } = await updatePassword(password)
    setLoading(false)
    if (error) { setError(error.message); return }
    setSuccess('Password updated. Redirecting…')
    setTimeout(() => navigate('/dashboard'), 1200)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f8f6' }}>
      <div style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 12, padding: '32px 36px', width: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <rect x="3" y="9" width="22" height="14" rx="3" fill="#3B6D1118" stroke="#3B6D11" strokeWidth="2"/>
            <line x1="14" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="2"/>
            <line x1="10" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="1.5"/>
            <line x1="18" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="1.5"/>
          </svg>
          <span style={{ fontSize: 17, fontWeight: 600, color: '#1a1a18' }}>Network Surveyor</span>
        </div>

        <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1a18', margin: '0 0 16px' }}>Set a new password</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>New password</label>
            <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="••••••••" />
          </div>
          <div>
            <label style={labelStyle}>Confirm new password</label>
            <input style={inputStyle} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} placeholder="••••••••" />
          </div>

          {error && <p style={{ fontSize: 12, color: '#A32D2D', margin: 0, background: '#FCEBEB', padding: '8px 10px', borderRadius: 6 }}>{error}</p>}
          {success && <p style={{ fontSize: 12, color: '#0F6E56', margin: 0, background: '#E1F5EE', padding: '8px 10px', borderRadius: 6 }}>{success}</p>}

          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '10px', background: '#378ADD', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1
          }}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: 11, color: '#666', marginBottom: 4 }
const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13, border: '0.5px solid #ccc',
  borderRadius: 8, boxSizing: 'border-box', outline: 'none', background: '#fff', color: '#1a1a18'
}

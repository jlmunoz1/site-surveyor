import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn, signUp } from '../lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState('')
  const [success, setSuccess] = useState('')
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setSuccess(''); setLoading(true)
    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) setError(error.message)
      else navigate('/dashboard')
    } else {
      const { error } = await signUp(email, password, name)
      if (error) setError(error.message)
      else setSuccess('Check your email to confirm your account, then log in.')
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f8f6' }}>
      <div style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 12, padding: '32px 36px', width: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <rect x="3" y="9" width="22" height="14" rx="3" fill="#3B6D1118" stroke="#3B6D11" strokeWidth="2"/>
            <line x1="14" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="2"/>
            <line x1="10" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="1.5"/>
            <line x1="18" y1="2" x2="14" y2="9" stroke="#3B6D11" strokeWidth="1.5"/>
          </svg>
          <span style={{ fontSize: 17, fontWeight: 600, color: '#1a1a18' }}>Network Surveyor</span>
        </div>

        <div style={{ display: 'flex', borderBottom: '0.5px solid #e0dfd8', marginBottom: 20 }}>
          {['login', 'signup'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '8px 0', background: 'none', border: 'none',
              borderBottom: mode === m ? '2px solid #378ADD' : '2px solid transparent',
              color: mode === m ? '#378ADD' : '#888', fontSize: 13, cursor: 'pointer', fontWeight: mode === m ? 500 : 400
            }}>
              {m === 'login' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'signup' && (
            <div>
              <label style={labelStyle}>Full name</label>
              <input style={inputStyle} type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Jane Smith" />
            </div>
          )}
          <div>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" minLength={8} />
          </div>

          {error && <p style={{ fontSize: 12, color: '#A32D2D', margin: 0, background: '#FCEBEB', padding: '8px 10px', borderRadius: 6 }}>{error}</p>}
          {success && <p style={{ fontSize: 12, color: '#0F6E56', margin: 0, background: '#E1F5EE', padding: '8px 10px', borderRadius: 6 }}>{success}</p>}

          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '10px', background: '#378ADD', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1
          }}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        {mode === 'login' && (
          <p style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 16 }}>
            Don't have an account?{' '}
            <button onClick={() => setMode('signup')} style={{ background: 'none', border: 'none', color: '#378ADD', cursor: 'pointer', fontSize: 11 }}>Sign up</button>
          </p>
        )}
      </div>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: 11, color: '#666', marginBottom: 4 }
const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13, border: '0.5px solid #ccc',
  borderRadius: 8, boxSizing: 'border-box', outline: 'none', background: '#fff', color: '#1a1a18'
}

import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginPage({ onLogin }) {
  const [mode, setMode]       = useState('login');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (mode === 'login') {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError(err.message); setLoading(false); }
      else onLogin(data.session);
    } else {
      const { error: signUpErr } = await supabase.auth.signUp({
        email, password, options: { data: { full_name: name } }
      });
      if (signUpErr) { setError(signUpErr.message); setLoading(false); return; }
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) { setError(signInErr.message); setLoading(false); }
      else onLogin(data.session);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logoWrap}>
          <div style={S.logo}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <rect x="2" y="3" width="20" height="4" rx="1"/>
              <rect x="2" y="9" width="20" height="4" rx="1"/>
              <rect x="2" y="15" width="20" height="4" rx="1"/>
              <circle cx="20" cy="5" r="1" fill="#fff"/>
              <circle cx="20" cy="11" r="1" fill="#fff"/>
              <circle cx="20" cy="17" r="1" fill="#fff"/>
            </svg>
          </div>
          <div>
            <div style={S.appName}>Site Surveyor</div>
            <div style={S.appSub}>Network Infrastructure Mapping</div>
          </div>
        </div>

        <h2 style={S.heading}>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
        {error && <div style={S.errorBox}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div style={S.field}>
              <label style={S.label}>Full name</label>
              <input style={S.input} type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required />
            </div>
          )}
          <div style={S.field}>
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@sagehealth.com" required />
          </div>
          <div style={S.field}>
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
          </div>
          <button style={{ ...S.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={S.toggle}>
          {mode === 'login'
            ? <>No account? <span style={S.link} onClick={() => { setMode('signup'); setError(''); }}>Sign up</span></>
            : <>Have account? <span style={S.link} onClick={() => { setMode('login'); setError(''); }}>Sign in</span></>
          }
        </div>
      </div>
    </div>
  );
}

const S = {
  page:     { minHeight: '100vh', background: '#f0f2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card:     { background: '#fff', borderRadius: 12, padding: '32px 28px', width: '100%', maxWidth: 420, boxShadow: '0 4px 24px rgba(0,0,0,.08)' },
  logoWrap: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 },
  logo:     { width: 44, height: 44, background: '#1B3A6B', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  appName:  { fontSize: 17, fontWeight: 700, color: '#1e293b' },
  appSub:   { fontSize: 12, color: '#64748b', marginTop: 1 },
  heading:  { fontSize: 18, fontWeight: 600, color: '#1e293b', marginBottom: 20 },
  errorBox: { background: '#fee2e2', color: '#991b1b', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 16 },
  field:    { marginBottom: 14 },
  label:    { display: 'block', fontSize: 12, fontWeight: 500, color: '#475569', marginBottom: 5 },
  input:    { width: '100%', fontSize: 13, padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', outline: 'none', boxSizing: 'border-box' },
  btn:      { width: '100%', padding: '10px 0', background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 6 },
  toggle:   { textAlign: 'center', fontSize: 13, color: '#64748b', marginTop: 18 },
  link:     { color: '#1d4ed8', cursor: 'pointer', fontWeight: 500 },
};

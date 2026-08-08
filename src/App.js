import React, { useEffect, useState, Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5', padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, maxWidth: 480, boxShadow: '0 4px 24px rgba(0,0,0,.08)', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ color: '#1e293b', marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ color: '#64748b', marginBottom: 20, fontSize: 13 }}>{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button onClick={() => window.location.reload()} style={{ background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { supabase } from './lib/supabase';
import { AuthProvider } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import AppLayout from './pages/AppLayout';

const STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  @keyframes spin { to { transform: rotate(360deg); } }
  input:focus, select:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 2px #bfdbfe !important; }
`;

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Loading
  if (session === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
        <style>{STYLE}</style>
        <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#1B3A6B', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // Not logged in
  if (!session) {
    return (
      <>
        <style>{STYLE}</style>
        <LoginPage onLogin={setSession} />
      </>
    );
  }

  // Logged in
  return (
    <ErrorBoundary>
      <style>{STYLE}</style>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </ErrorBoundary>
  );
}

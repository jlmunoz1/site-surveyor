import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import AuthPage from './pages/AuthPage'
import Dashboard from './pages/Dashboard'
import SurveyEditor from './pages/SurveyEditor'
import GeoReference from './pages/GeoReference'
import BulkExport from './pages/BulkExport'
import AdminPage from './pages/AdminPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AccessExpiredPage from './pages/AccessExpiredPage'

function ProtectedRoute({ children }) {
  const { user, loading, isExpired } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: 14, color: '#888' }}>Loading…</div>
  if (!user) return <Navigate to="/" replace />
  if (isExpired) return <Navigate to="/access-expired" replace />
  return children
}

function AdminRoute({ children }) {
  const { user, loading, isAdmin, isExpired } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: 14, color: '#888' }}>Loading…</div>
  if (!user) return <Navigate to="/" replace />
  if (isExpired) return <Navigate to="/access-expired" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />
  return children
}

function LoggedInRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: 14, color: '#888' }}>Loading…</div>
  return user ? children : <Navigate to="/" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AuthPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/survey/:id" element={<ProtectedRoute><SurveyEditor /></ProtectedRoute>} />
          <Route path="/survey/:id/georeference" element={<ProtectedRoute><GeoReference /></ProtectedRoute>} />
          <Route path="/enterprise/:id/export" element={<ProtectedRoute><BulkExport /></ProtectedRoute>} />
          <Route path="/shared/:token" element={<SurveyEditor />} />
          <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="/reset-password" element={<ProtectedRoute><ResetPasswordPage /></ProtectedRoute>} />
          <Route path="/access-expired" element={<LoggedInRoute><AccessExpiredPage /></LoggedInRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

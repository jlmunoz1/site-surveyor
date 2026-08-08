import React, { useEffect, useRef, useState } from 'react';
import { exportFullPDF } from '../components/ExportPDF';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import PortMapperTab from '../components/PortMapperTab';
import NetworkMapTab from '../components/NetworkMapTab';
import PortGuideTab  from '../components/PortGuideTab';
import AdminTab      from '../components/AdminTab';

const TABS = [
  { id: 'mapper', label: 'Port Mapper', icon: 'ti-server-2' },
  { id: 'netmap', label: 'Network Map', icon: 'ti-topology-star-3' },
  { id: 'guide',  label: 'Port Guide',  icon: 'ti-book-2' },
  { id: 'admin',  label: 'Admin',       icon: 'ti-settings', adminOnly: true },
];

export default function AppLayout() {
  const { profile, loading, signOut } = useAuth();
  const [tab, setTab]         = useState('mapper');
  const [menuOpen, setMenuOpen]     = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [sites, setSites]     = useState([]);
  const mapCanvasRef = useRef(null);

  useEffect(() => {
    supabase.from('sites').select('id,name').order('name').then(({ data }) => setSites(data || []));
  }, []);

  // Close export menu on outside click — must be before early return (Rules of Hooks)
  useEffect(() => {
    if (!exportMenu) return;
    const handler = () => setExportMenu(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportMenu]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#1B3A6B', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const role = (profile?.role && ['admin','tech','readonly'].includes(profile.role)) ? profile.role : 'readonly';
  const visibleTabs = TABS.filter(t => !t.adminOnly || role === 'admin');
  const roleBadge = { admin: ['#fee2e2','#991b1b'], tech: ['#dbeafe','#1e40af'], readonly: ['#f1f5f9','#475569'] };
  const roleColors = roleBadge[role] || roleBadge.readonly;
  const rbg = roleColors[0], rc = roleColors[1];

  async function handleSignOut() {
    await signOut();
    window.location.href = '/';
  }

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", minHeight: '100vh', background: '#f0f2f5' }}>
      {/* Topbar */}
      <div style={{ background: '#1B3A6B', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, background: '#2E75B6', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <rect x="2" y="3" width="20" height="4" rx="1"/><rect x="2" y="9" width="20" height="4" rx="1"/><rect x="2" y="15" width="20" height="4" rx="1"/>
              <circle cx="20" cy="5" r="1" fill="#fff"/><circle cx="20" cy="11" r="1" fill="#fff"/><circle cx="20" cy="17" r="1" fill="#fff"/>
            </svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Sage Port Mapper</span>
          <span style={{ fontSize: 12, color: '#93b4d9' }}>UniFi Infrastructure</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: rbg, color: rc }}>{role}</span>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => exportStatus ? setExportStatus('') : setExportMenu(m => !m)}
              style={{ background: '#2E75B6', border: '1px solid #4a7aa8', color: '#fff', borderRadius: 6, padding: '5px 12px', cursor: exportStatus ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, opacity: exportStatus ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              {exportStatus ? exportStatus + ' ×' : '⬇ Export PDF'}{!exportStatus && <span style={{ fontSize: 10 }}>▾</span>}
            </button>
            {exportMenu && !exportStatus && (
              <div style={{ position: 'absolute', right: 0, top: 36, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 200, zIndex: 200 }}>
                <div style={{ padding: '8px 12px 4px', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>Export scope</div>
                <button
                  onMouseDown={e => { e.stopPropagation(); setExportMenu(false); exportFullPDF({ mapCanvasRef, statusMsg: setExportStatus, siteId: null }); }}
                  style={{ width: '100%', padding: '9px 14px', fontSize: 13, color: '#1e293b', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid #f1f5f9', fontWeight: 600 }}>
                  🗂 All sites
                </button>
                {sites.map(s => (
                  <button key={s.id}
                    onMouseDown={e => { e.stopPropagation(); setExportMenu(false); exportFullPDF({ mapCanvasRef, statusMsg: setExportStatus, siteId: s.id, siteName: s.name }); }}
                    style={{ width: '100%', padding: '9px 14px', fontSize: 13, color: '#374151', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid #f1f5f9' }}>
                    📄 {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setMenuOpen(o => !o)} style={{ background: 'transparent', border: '1px solid #4a7aa8', color: '#93b4d9', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}>
              {profile?.email} ▾
            </button>
            {menuOpen && (
              <div style={{ position: 'absolute', right: 0, top: 36, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.1)', minWidth: 160, zIndex: 100 }}>
                <button onClick={handleSignOut} style={{ width: '100%', padding: '10px 12px', fontSize: 13, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '2px solid #e2e8f0', padding: '0 24px' }}>
        {visibleTabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setMenuOpen(false); }}
            style={{ padding: '12px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.id ? '#1d4ed8' : 'transparent'}`, marginBottom: -2, color: tab === t.id ? '#1d4ed8' : '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className={`ti ${t.icon}`} />{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ display: tab === 'mapper' ? '' : 'none' }}><PortMapperTab /></div>
      <div style={{ display: tab === 'netmap' ? '' : 'none' }}><NetworkMapTab mapCanvasRef={mapCanvasRef} /></div>
      <div style={{ display: tab === 'guide'  ? '' : 'none' }}><PortGuideTab /></div>
      {role === 'admin' && <div style={{ display: tab === 'admin' ? '' : 'none' }}><AdminTab /></div>}
    </div>
  );
}

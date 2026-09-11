import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getProfiles, getSurveys, getProjects, getEnterprises, renameEnterprise, deleteEnterprise, mergeEnterprises, setUserAdmin, setUserContractor, setUserAccessExpiration, sendPasswordReset, signOut, adminCreateUser, adminDeleteUser, adminListOrphans, supabase } from '../lib/supabase'

export default function AdminPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [stats, setStats] = useState({}) // id -> { surveys, projects }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [resetStatus, setResetStatus] = useState({}) // id -> 'sending' | 'sent' | error message

  // Enterprise management — separate from the per-user table above.
  // getEnterprises() already returns every enterprise across all users
  // (the RLS select policy grants that to admins), which is what makes
  // this the right place to spot duplicates that the Dashboard's
  // per-project grouping would otherwise hide (it skips enterprises
  // with zero visible projects entirely).
  const [enterprises, setEnterprises] = useState([])
  const [projects, setProjects] = useState([])
  const [entLoading, setEntLoading] = useState(true)
  const [entError, setEntError] = useState('')
  const [entBusyId, setEntBusyId] = useState(null)
  const [editingEntId, setEditingEntId] = useState(null)
  const [entNameInput, setEntNameInput] = useState('')
  const [mergeTarget, setMergeTarget] = useState({}) // enterpriseId -> chosen target id

  // Direct admin-side user creation — bypasses the trigger-based
  // signup flow entirely; role is chosen explicitly here rather than
  // inferred from project_members at signup time.
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('staff')
  const [newProjectIds, setNewProjectIds] = useState([])
  const [creatingUser, setCreatingUser] = useState(false)
  const [createUserError, setCreateUserError] = useState('')
  const [createUserMsg, setCreateUserMsg] = useState('')

  // Orphaned accounts — real auth.users rows with no matching
  // profiles row, invisible in the Users table above (which is driven
  // by profiles) even though they're sitting in the database. Surfaces
  // the mismatch so it can be reconciled instead of silently ignored.
  const [orphans, setOrphans] = useState([])
  const [orphansLoading, setOrphansLoading] = useState(true)
  const [orphansError, setOrphansError] = useState('')
  const [orphanBusyId, setOrphanBusyId] = useState(null)
  const [fixingOrphan, setFixingOrphan] = useState(null) // orphan object currently choosing a role for
  const [fixRole, setFixRole] = useState('staff')

  useEffect(() => { loadAll(); loadEnterprises(); loadOrphans() }, [])

  async function getAccessToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  async function loadOrphans() {
    setOrphansLoading(true)
    const accessToken = await getAccessToken()
    if (!accessToken) { setOrphansLoading(false); return }
    const { data, error } = await adminListOrphans({ accessToken })
    if (error) setOrphansError(error)
    else setOrphans(data?.orphans || [])
    setOrphansLoading(false)
  }

  async function loadEnterprises() {
    setEntLoading(true)
    const [{ data: entData, error: entErr }, { data: projData }] = await Promise.all([
      getEnterprises(),
      getProjects(),
    ])
    if (entErr) setEntError(entErr.message)
    setEnterprises(entData || [])
    setProjects(projData || [])
    setEntLoading(false)
  }

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

  async function toggleContractor(u) {
    if (u.id === user.id) return
    setBusyId(u.id)
    const { error } = await setUserContractor(u.id, !u.is_contractor)
    if (error) setError(error.message)
    else setUsers(list => list.map(x => x.id === u.id ? { ...x, is_contractor: !x.is_contractor } : x))
    setBusyId(null)
  }

  function toggleNewProjectId(id) {
    setNewProjectIds(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  async function handleCreateUser(e) {
    e.preventDefault()
    if (!newEmail.trim()) return
    setCreatingUser(true); setCreateUserError(''); setCreateUserMsg('')
    const accessToken = await getAccessToken()
    const { data, error } = await adminCreateUser({
      accessToken,
      email: newEmail.trim(),
      fullName: newName.trim() || null,
      role: newRole,
      projectIds: newRole === 'contractor' ? newProjectIds : [],
    })
    setCreatingUser(false)
    if (error) { setCreateUserError(error); return }
    setCreateUserMsg(data?.warning || `Created — invite email sent to ${newEmail.trim()}`)
    setNewEmail(''); setNewName(''); setNewRole('staff'); setNewProjectIds([])
    loadAll()
    setTimeout(() => setCreateUserMsg(''), 6000)
  }

  async function handleDeleteUser(u) {
    if (!window.confirm(`Permanently delete ${u.email}? This removes their account entirely and can't be undone.`)) return
    setBusyId(u.id)
    const accessToken = await getAccessToken()
    const { error } = await adminDeleteUser({ accessToken, targetUserId: u.id })
    setBusyId(null)
    if (error) { setError(error); return }
    setUsers(list => list.filter(x => x.id !== u.id))
  }

  async function handleDeleteOrphan(o) {
    if (!window.confirm(`Permanently delete this account (${o.email})? This can't be undone.`)) return
    setOrphanBusyId(o.id)
    const accessToken = await getAccessToken()
    const { error } = await adminDeleteUser({ accessToken, targetUserId: o.id })
    setOrphanBusyId(null)
    if (error) { setOrphansError(error); return }
    setOrphans(list => list.filter(x => x.id !== o.id))
  }

  async function handleFixOrphan(o) {
    setOrphanBusyId(o.id)
    const accessToken = await getAccessToken()
    const { error } = await adminCreateUser({
      accessToken,
      email: o.email,
      fullName: null,
      role: fixRole,
      targetUserId: o.id,
    })
    setOrphanBusyId(null)
    if (error) { setOrphansError(error); return }
    setOrphans(list => list.filter(x => x.id !== o.id))
    setFixingOrphan(null)
    loadAll()
  }

  function daysFromNow(days) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString()
  }

  async function handleSetExpiration(u, days) {
    setBusyId(u.id)
    const expiresAt = days === null ? null : daysFromNow(days)
    const { error } = await setUserAccessExpiration(u.id, expiresAt)
    if (error) setError(error.message)
    else setUsers(list => list.map(x => x.id === u.id ? { ...x, access_expires_at: expiresAt } : x))
    setBusyId(null)
  }

  async function handleResetPassword(u) {
    setResetStatus(s => ({ ...s, [u.id]: 'sending' }))
    const { error } = await sendPasswordReset(u.email)
    setResetStatus(s => ({ ...s, [u.id]: error ? error.message : 'sent' }))
    // Clear the "sent" confirmation after a few seconds so the button resets
    setTimeout(() => setResetStatus(s => ({ ...s, [u.id]: null })), 4000)
  }

  async function handleSignOut() {
    await signOut(); navigate('/')
  }

  function startEditEnt(ent) {
    setEntNameInput(ent.name)
    setEditingEntId(ent.id)
  }
  async function handleRenameEnt(ent) {
    const trimmed = entNameInput.trim()
    setEditingEntId(null)
    if (!trimmed || trimmed === ent.name) return
    setEntBusyId(ent.id)
    const { error } = await renameEnterprise(ent.id, trimmed)
    setEntBusyId(null)
    if (error) { setEntError(error.message); return }
    setEnterprises(list => list.map(x => x.id === ent.id ? { ...x, name: trimmed } : x))
  }
  async function handleDeleteEnt(ent) {
    const count = projects.filter(p => p.enterprise_id === ent.id).length
    const msg = count > 0
      ? `Delete "${ent.name}"? Its ${count} project${count !== 1 ? 's' : ''} will move to Unassigned, not be deleted.`
      : `Delete "${ent.name}"?`
    if (!window.confirm(msg)) return
    setEntBusyId(ent.id)
    const { error } = await deleteEnterprise(ent.id)
    setEntBusyId(null)
    if (error) { setEntError(error.message); return }
    setEnterprises(list => list.filter(x => x.id !== ent.id))
    setProjects(list => list.map(p => p.enterprise_id === ent.id ? { ...p, enterprise_id: null } : p))
  }
  async function handleMergeEnt(fromEnt) {
    const toId = mergeTarget[fromEnt.id]
    if (!toId) return
    const toEnt = enterprises.find(x => x.id === toId)
    const count = projects.filter(p => p.enterprise_id === fromEnt.id).length
    if (!window.confirm(`Merge "${fromEnt.name}" into "${toEnt?.name}"? ${count} project${count !== 1 ? 's' : ''} will move over, and "${fromEnt.name}" will be deleted.`)) return
    setEntBusyId(fromEnt.id)
    const { error } = await mergeEnterprises(fromEnt.id, toId)
    setEntBusyId(null)
    if (error) { setEntError(error.message); return }
    setEnterprises(list => list.filter(x => x.id !== fromEnt.id))
    setProjects(list => list.map(p => p.enterprise_id === fromEnt.id ? { ...p, enterprise_id: toId } : p))
    setMergeTarget(m => { const n = { ...m }; delete n[fromEnt.id]; return n })
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

      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1a1a18', margin: '0 0 4px' }}>Registered users</h1>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
            {users.length} account{users.length !== 1 ? 's' : ''} — staff and contractors who have signed up.
          </p>
          <button onClick={() => setShowCreateUser(v => !v)} style={{ ...ghostBtn, color: '#378ADD', borderColor: '#AFCFF0' }}>
            {showCreateUser ? 'Cancel' : '+ Add user'}
          </button>
        </div>

        {showCreateUser && (
          <form onSubmit={handleCreateUser} style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <input type="email" required placeholder="email@company.com" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                style={{ flex: '1 1 220px', fontSize: 13, padding: '7px 10px', border: '0.5px solid #ccc', borderRadius: 6 }} />
              <input placeholder="Full name (optional)" value={newName} onChange={e => setNewName(e.target.value)}
                style={{ flex: '1 1 180px', fontSize: 13, padding: '7px 10px', border: '0.5px solid #ccc', borderRadius: 6 }} />
              <select value={newRole} onChange={e => setNewRole(e.target.value)}
                style={{ fontSize: 13, padding: '7px 10px', border: '0.5px solid #ccc', borderRadius: 6 }}>
                <option value="staff">Internal staff (full org access)</option>
                <option value="contractor">Contractor (scoped)</option>
              </select>
            </div>
            {newRole === 'contractor' && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Grant access to project(s) right away (optional — can also invite from Dashboard later):</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {projects.map(p => (
                    <button type="button" key={p.id} onClick={() => toggleNewProjectId(p.id)}
                      style={{
                        fontSize: 11, padding: '4px 9px', borderRadius: 12, cursor: 'pointer',
                        border: newProjectIds.includes(p.id) ? '0.5px solid #378ADD' : '0.5px solid #ccc',
                        background: newProjectIds.includes(p.id) ? '#E9F2FC' : '#fff',
                        color: newProjectIds.includes(p.id) ? '#378ADD' : '#666',
                      }}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {createUserError && <p style={{ fontSize: 12, color: '#A32D2D', margin: '0 0 10px' }}>{createUserError}</p>}
            {createUserMsg && <p style={{ fontSize: 12, color: '#1D9E75', margin: '0 0 10px' }}>{createUserMsg}</p>}
            <button type="submit" disabled={creatingUser} style={{ ...ghostBtn, color: '#fff', background: '#378ADD', borderColor: '#378ADD' }}>
              {creatingUser ? 'Creating…' : 'Create & send invite'}
            </button>
          </form>
        )}

        {error && <p style={{ fontSize: 12, color: '#A32D2D', background: '#FCEBEB', padding: '8px 12px', borderRadius: 6, marginBottom: 16 }}>{error}</p>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 85px 60px 60px 95px 100px 130px 130px 40px', gap: 8, padding: '10px 16px', background: '#f8f8f6', borderBottom: '0.5px solid #e0dfd8', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.3 }}>
              <span>Name</span>
              <span>Email</span>
              <span>Joined</span>
              <span>Surveys</span>
              <span>Projects</span>
              <span>Role</span>
              <span>Scope</span>
              <span>Access</span>
              <span>Password</span>
              <span></span>
            </div>
            {users.map(u => {
              const status = resetStatus[u.id]
              const isSending = status === 'sending'
              const isSent = status === 'sent'
              const isErr = status && status !== 'sending' && status !== 'sent'
              const exp = u.access_expires_at ? new Date(u.access_expires_at) : null
              const isExpired = exp && exp <= new Date()
              return (
                <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 85px 60px 60px 95px 100px 130px 130px 40px', gap: 8, padding: '12px 16px', borderBottom: '0.5px solid #f0efea', alignItems: 'center', fontSize: 13 }}>
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
                  <button
                    onClick={() => toggleContractor(u)}
                    disabled={u.id === user.id || busyId === u.id}
                    title={u.id === user.id ? "You can't change your own scope here" : u.is_contractor ? 'Sees only projects they own or were invited to' : 'Sees every project in the org'}
                    style={{
                      padding: '5px 10px', fontSize: 11, fontWeight: 500, borderRadius: 6, cursor: u.id === user.id ? 'default' : 'pointer',
                      border: u.is_contractor ? '0.5px solid #F0D488' : '0.5px solid #ccc',
                      background: u.is_contractor ? '#FFF7E6' : '#fff',
                      color: u.is_contractor ? '#BA7517' : '#666',
                      opacity: u.id === user.id ? 0.5 : 1,
                    }}
                  >
                    {u.is_contractor ? 'Scoped' : 'Full org'}
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 10.5, color: isExpired ? '#A32D2D' : exp ? '#B36B00' : '#888' }}>
                      {exp ? `${isExpired ? 'Expired' : 'Expires'} ${exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No limit'}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => handleSetExpiration(u, 30)} disabled={busyId === u.id} title="Set access to expire 30 days from today"
                        style={tinyBtn}>
                        {exp ? '↻ 30d' : 'Limit 30d'}
                      </button>
                      {exp && (
                        <button onClick={() => handleSetExpiration(u, null)} disabled={busyId === u.id} title="Remove the expiration — permanent access"
                          style={tinyBtn}>
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleResetPassword(u)}
                    disabled={isSending}
                    title={isErr ? status : ''}
                    style={{
                      padding: '5px 10px', fontSize: 11, fontWeight: 500, borderRadius: 6,
                      cursor: isSending ? 'wait' : 'pointer',
                      border: isSent ? '0.5px solid #9AD4BE' : isErr ? '0.5px solid #F09595' : '0.5px solid #ccc',
                      background: isSent ? '#E1F5EE' : isErr ? '#FCEBEB' : '#fff',
                      color: isSent ? '#0F6E56' : isErr ? '#A32D2D' : '#666',
                    }}
                  >
                    {isSending ? 'Sending…' : isSent ? 'Email sent ✓' : isErr ? 'Failed — retry' : 'Reset password'}
                  </button>
                  <button onClick={() => handleDeleteUser(u)} disabled={u.id === user.id || busyId === u.id}
                    title={u.id === user.id ? "You can't delete your own account here" : 'Delete this account permanently'}
                    style={{ background: 'none', border: 'none', cursor: u.id === user.id ? 'default' : 'pointer', color: '#ccc', fontSize: 14, padding: '2px 4px', opacity: u.id === user.id ? 0.4 : 1 }}>
                    <i className="ti ti-trash" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {!orphansLoading && orphans.length > 0 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1a1a18', margin: '40px 0 4px' }}>Orphaned accounts</h1>
            <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
              These are real accounts in the database with no matching profile — invisible in the Users table above.
              Usually left over from a broken signup. Finish setting them up (pick a role) or delete them.
            </p>
            {orphansError && <p style={{ fontSize: 12, color: '#A32D2D', background: '#FCEBEB', padding: '8px 12px', borderRadius: 6, marginBottom: 16 }}>{orphansError}</p>}
            <div style={{ background: '#FFF7E6', border: '0.5px solid #F0D488', borderRadius: 10, overflow: 'hidden' }}>
              {orphans.map(o => (
                <div key={o.id} style={{ padding: '10px 16px', borderBottom: '0.5px solid #F0E0A0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ flex: 1, color: '#1a1a18' }}>{o.email}</span>
                    <span style={{ fontSize: 11, color: '#8A6C1F' }}>
                      Created {o.created_at ? new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      {o.last_sign_in_at ? ' · has logged in' : ' · never logged in'}
                    </span>
                    {fixingOrphan?.id === o.id ? (
                      <>
                        <select value={fixRole} onChange={e => setFixRole(e.target.value)} style={{ fontSize: 11, padding: '4px 6px', borderRadius: 4, border: '0.5px solid #ccc' }}>
                          <option value="staff">Staff</option>
                          <option value="contractor">Contractor</option>
                        </select>
                        <button onClick={() => handleFixOrphan(o)} disabled={orphanBusyId === o.id} style={{ ...tinyBtn, color: '#1D9E75', borderColor: '#9AD9BE' }}>Confirm</button>
                        <button onClick={() => setFixingOrphan(null)} style={tinyBtn}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setFixingOrphan(o); setFixRole('staff') }} disabled={orphanBusyId === o.id} style={{ ...tinyBtn, color: '#378ADD', borderColor: '#AFCFF0' }}>Create profile</button>
                        <button onClick={() => handleDeleteOrphan(o)} disabled={orphanBusyId === o.id} style={{ ...tinyBtn, color: '#A32D2D', borderColor: '#F09595' }}>Delete</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1a1a18', margin: '40px 0 4px' }}>Enterprises</h1>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 24px' }}>
          {enterprises.length} enterprise{enterprises.length !== 1 ? 's' : ''} across all users — this list isn't
          filtered by project count, so empty or duplicate ones that the Dashboard hides still show up here.
        </p>

        {entError && (
          <p style={{ fontSize: 12, color: '#A32D2D', background: '#FCEBEB', padding: '8px 12px', borderRadius: 6, marginBottom: 16 }}>
            {entError} <button onClick={() => setEntError('')} style={{ ...tinyBtn, marginLeft: 8 }}>Dismiss</button>
          </p>
        )}

        {entLoading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>Loading…</div>
        ) : enterprises.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#aaa', fontSize: 13 }}>No enterprises yet.</div>
        ) : (
          <div style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 70px 90px 1.4fr 60px', gap: 8, padding: '10px 16px', background: '#f8f8f6', borderBottom: '0.5px solid #e0dfd8', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.3 }}>
              <span>Name</span>
              <span>Owner</span>
              <span>Projects</span>
              <span>Created</span>
              <span>Merge into…</span>
              <span></span>
            </div>
            {enterprises.map(ent => {
              const normalized = ent.name.trim().toLowerCase()
              const isDuplicate = enterprises.filter(x => x.name.trim().toLowerCase() === normalized).length > 1
              const owner = users.find(u => u.id === ent.user_id)
              const count = projects.filter(p => p.enterprise_id === ent.id).length
              const otherEnts = enterprises.filter(x => x.id !== ent.id)
              return (
                <div key={ent.id} style={{
                  display: 'grid', gridTemplateColumns: '1.3fr 1fr 70px 90px 1.4fr 60px', gap: 8, padding: '10px 16px',
                  borderBottom: '0.5px solid #f0efea', alignItems: 'center', fontSize: 13,
                  background: isDuplicate ? '#FFF7E6' : 'transparent',
                }}>
                  {editingEntId === ent.id ? (
                    <input
                      autoFocus
                      value={entNameInput}
                      onChange={e => setEntNameInput(e.target.value)}
                      onBlur={() => handleRenameEnt(ent)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenameEnt(ent); if (e.key === 'Escape') setEditingEntId(null) }}
                      style={{ fontSize: 13, color: '#1a1a18', background: '#fff', border: '0.5px solid #378ADD', borderRadius: 6, padding: '4px 7px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                    />
                  ) : (
                    <span onClick={() => startEditEnt(ent)} title="Click to rename" style={{ color: '#1a1a18', fontWeight: 500, cursor: 'text', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {ent.name}
                      {isDuplicate && <span title="Another enterprise has this same name" style={{ fontSize: 9.5, background: '#F0D488', color: '#5A4200', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>DUPLICATE</span>}
                    </span>
                  )}
                  <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{owner?.email || '—'}</span>
                  <span style={{ color: '#666' }}>{count}</span>
                  <span style={{ color: '#aaa', fontSize: 12 }}>
                    {ent.created_at ? new Date(ent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select
                      value={mergeTarget[ent.id] || ''}
                      onChange={e => setMergeTarget(m => ({ ...m, [ent.id]: e.target.value }))}
                      style={{ fontSize: 11, border: '0.5px solid #ccc', borderRadius: 4, padding: '3px 4px', flex: 1, minWidth: 0 }}
                    >
                      <option value="">Choose…</option>
                      {otherEnts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <button onClick={() => handleMergeEnt(ent)} disabled={!mergeTarget[ent.id] || entBusyId === ent.id} title="Move this enterprise's projects into the chosen one, then delete this one" style={tinyBtn}>
                      Merge
                    </button>
                  </div>
                  <button onClick={() => handleDeleteEnt(ent)} disabled={entBusyId === ent.id}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 14, padding: '2px 4px', justifySelf: 'end' }}
                    title="Delete this enterprise">
                    <i className="ti ti-trash" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const ghostBtn = { padding: '6px 14px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 12, cursor: 'pointer' }
const tinyBtn = { padding: '2px 6px', fontSize: 10, border: '0.5px solid #ccc', borderRadius: 4, background: '#fff', color: '#666', cursor: 'pointer' }

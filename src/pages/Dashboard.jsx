import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { v4 as uuidv4 } from 'uuid'
import { getPdfPageCount } from '../lib/pdf'
import {
  getSurveys, createSurvey, deleteSurvey, signOut,
  getProjects, createProject, deleteProject, getProfiles, renameProject,
  syncProjectToPortMapper, setProjectPortMapperSiteId,
  uploadFloorPlan, saveSurvey,
  getProjectMembers, inviteToProject, removeProjectMember, sendProjectInviteEmail,
} from '../lib/supabase'

export default function Dashboard() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [surveys, setSurveys] = useState([])
  const [projects, setProjects] = useState([])
  const [profiles, setProfiles] = useState({}) // id -> { email, full_name }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // "mine" = only what I created. "team" = everyone else's.
  const [tab, setTab] = useState('mine')

  // New project modal
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)

  // New survey modal
  const [showNewSurvey, setShowNewSurvey] = useState(false)
  const [newSurveyName, setNewSurveyName] = useState('')
  const [newSurveyProject, setNewSurveyProject] = useState('')
  const [creatingSurvey, setCreatingSurvey] = useState(false)

  // Expanded projects
  const [expanded, setExpanded] = useState({})
  const [uploadingPlanFor, setUploadingPlanFor] = useState(null) // project id currently uploading

  // Click-to-edit project name — mirrors the survey editor's rename
  // pattern (click name, edit inline, blur/Enter to save).
  const [editingProjectId, setEditingProjectId] = useState(null)
  const [projectNameInput, setProjectNameInput] = useState('')
  const [shareProject, setShareProject] = useState(null) // project object currently being shared
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteInfo, setInviteInfo] = useState('')
  const floorPlanInputRef = useRef(null)
  const pendingProjectRef = useRef(null)

  useEffect(() => {
    if (user) loadAll()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true)
    const [{ data: survData }, { data: projData }, { data: profData }] = await Promise.all([
      getSurveys(),
      getProjects(),
      getProfiles(),
    ])
    setSurveys(survData || [])
    setProjects(projData || [])
    const pMap = {}
    ;(profData || []).forEach(p => { pMap[p.id] = p })
    setProfiles(pMap)
    // Auto-expand all projects
    const exp = {}
    ;(projData || []).forEach(p => { exp[p.id] = true })
    setExpanded(exp)
    setLoading(false)
  }

  function ownerLabel(userId) {
    if (userId === user.id) return null
    const p = profiles[userId]
    return p?.full_name || p?.email || 'Teammate'
  }

  async function handleCreateProject(e) {
    e.preventDefault()
    if (!newProjectName.trim()) return
    setCreatingProject(true)
    const { data, error } = await createProject(user.id, newProjectName.trim())
    if (error) { setError(error.message); setCreatingProject(false); return }
    setNewProjectName(''); setShowNewProject(false); setCreatingProject(false)
    loadAll()
    // Best-effort mirror into Port Mapper — never blocks project
    // creation here, just surfaces a soft warning if it fails. If it
    // succeeds, save the returned site id so racks can be created
    // against this project later (e.g. when adding an MDF/IDF).
    const { site, error: syncError } = await syncProjectToPortMapper(data.name)
    if (syncError) {
      setError(`Project created, but couldn't sync to Port Mapper: ${syncError}`)
    } else if (site?.id) {
      await setProjectPortMapperSiteId(data.id, site.id)
    }
  }

  async function handleRenameProject(project) {
    const trimmed = projectNameInput.trim()
    setEditingProjectId(null)
    if (!trimmed || trimmed === project.name) return
    // Optimistic update so the name doesn't flicker back while the
    // request is in flight; rolled back below if it turns out RLS
    // silently rejected the write.
    const previousName = project.name
    setProjects(ps => ps.map(p => p.id === project.id ? { ...p, name: trimmed } : p))
    const { error } = await renameProject(project.id, trimmed)
    if (error) {
      setProjects(ps => ps.map(p => p.id === project.id ? { ...p, name: previousName } : p))
      setError('Rename failed: ' + error.message)
    }
  }

  function triggerFloorPlanUpload(project) {
    pendingProjectRef.current = project
    floorPlanInputRef.current.click()
  }

  async function handleFloorPlanFileChange(e) {
    const file = e.target.files[0]
    e.target.value = ''
    const project = pendingProjectRef.current
    pendingProjectRef.current = null
    if (!file || !project) return

    setError(''); setInfo('')
    setUploadingPlanFor(project.id)
    const tempId = uuidv4()
    const { url, error: uploadErr } = await uploadFloorPlan(tempId, file)
    if (uploadErr) { setError('Upload failed: ' + uploadErr.message); setUploadingPlanFor(null); return }

    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    let pageCount = 1
    if (isPDF) {
      try { pageCount = await getPdfPageCount(url) } catch (err) { console.warn('Could not read PDF page count:', err) }
    }

    if (pageCount > 1 && !window.confirm(
      `This PDF has ${pageCount} pages. Create ${pageCount} surveys in "${project.name}" — one per floor?`
    )) {
      setUploadingPlanFor(null)
      return
    }

    let created = 0
    for (let p = 1; p <= pageCount; p++) {
      const name = pageCount > 1 ? `Floor ${p}` : file.name.replace(/\.[^.]+$/, '')
      const { data: newSurvey, error: createErr } = await createSurvey(user.id, name, project.id)
      if (createErr || !newSurvey) { console.warn(`Couldn't create survey for page ${p}:`, createErr); continue }
      const { error: saveErr } = await saveSurvey(newSurvey.id, { floor_plan_url: url, floor_plan_page: p })
      if (!saveErr) created++
    }
    setUploadingPlanFor(null)
    setInfo(created === pageCount
      ? `Created ${created} survey${created !== 1 ? 's' : ''} from the floor plan`
      : `Created ${created} of ${pageCount} survey(s) — check console for errors`)
    setTimeout(() => setInfo(''), 4000)
    loadAll()
  }

  async function openShareModal(project) {
    setShareProject(project)
    setInviteEmail(''); setInviteError(''); setInviteInfo('')
    setLoadingMembers(true)
    const { data } = await getProjectMembers(project.id)
    setMembers(data || [])
    setLoadingMembers(false)
  }

  async function handleInvite(e) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true); setInviteError(''); setInviteInfo('')
    const { data, error } = await inviteToProject(shareProject.id, inviteEmail, user.id)
    if (error) {
      setInviting(false)
      setInviteError(error.message.includes('duplicate') ? 'Already invited.' : error.message)
      return
    }
    setMembers(m => [...m, data])
    const emailToSend = inviteEmail.trim()
    setInviteEmail('')
    // Best-effort: send an actual invite email so they know they've
    // been given access, rather than granting it silently.
    const { sent, reason, error: emailError } = await sendProjectInviteEmail(emailToSend, shareProject.name)
    setInviting(false)
    if (emailError) setInviteError(`Access granted, but the invite email failed to send: ${emailError}`)
    else if (sent) setInviteInfo(`Invite email sent to ${emailToSend}.`)
    else if (reason === 'already_has_account') setInviteInfo(`${emailToSend} already has an account — access granted, no email needed.`)
  }

  async function handleRemoveMember(id) {
    const { error } = await removeProjectMember(id)
    if (error) { setInviteError(error.message); return }
    setMembers(m => m.filter(x => x.id !== id))
  }

  async function handleDeleteProject(id, name) {
    const projectSurveys = surveys.filter(s => s.project_id === id)
    const msg = projectSurveys.length > 0
      ? `Delete project "${name}" and its ${projectSurveys.length} survey(s)? This cannot be undone.`
      : `Delete project "${name}"?`
    if (!window.confirm(msg)) return
    const { error } = await deleteProject(id)
    if (error) { setError(error.message); return }
    loadAll()
  }

  async function handleCreateSurvey(e) {
    e.preventDefault()
    if (!newSurveyName.trim()) return
    setCreatingSurvey(true)
    const { data, error } = await createSurvey(user.id, newSurveyName.trim(), newSurveyProject || null)
    if (error) { setError(error.message); setCreatingSurvey(false); return }
    setNewSurveyName(''); setNewSurveyProject(''); setShowNewSurvey(false); setCreatingSurvey(false)
    navigate(`/survey/${data.id}`)
  }

  async function handleDeleteSurvey(id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    const { error } = await deleteSurvey(id)
    if (error) { setError(error.message); return }
    setSurveys(s => s.filter(x => x.id !== id))
  }

  async function handleSignOut() {
    await signOut(); navigate('/')
  }

  const displayName = user?.user_metadata?.full_name || user?.email

  // Split everything by ownership. "mine" tab = things I created.
  // "team" tab = everything created by anyone else.
  const visibleProjects = tab === 'mine'
    ? projects.filter(p => p.user_id === user.id)
    : projects.filter(p => p.user_id !== user.id)
  const visibleUnassigned = (tab === 'mine'
    ? surveys.filter(s => s.user_id === user.id)
    : surveys.filter(s => s.user_id !== user.id)
  ).filter(s => !s.project_id)

  const myCount = projects.filter(p => p.user_id === user.id).length + surveys.filter(s => s.user_id === user.id && !s.project_id).length
  const teamCount = projects.filter(p => p.user_id !== user.id).length + surveys.filter(s => s.user_id !== user.id && !s.project_id).length

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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: '#666' }}>{displayName}</span>
          {isAdmin && <button onClick={() => navigate('/admin')} style={ghostBtn}>Admin</button>}
          <button onClick={handleSignOut} style={ghostBtn}>Sign out</button>
        </div>
      </nav>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1a1a18', margin: 0 }}>Projects & Surveys</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowNewProject(true)} style={ghostBtn}>
              <i className="ti ti-folder-plus" style={{ marginRight: 4 }} /> New project
            </button>
            <button onClick={() => setShowNewSurvey(true)} style={primaryBtn}>
              <i className="ti ti-plus" style={{ marginRight: 4 }} /> New survey
            </button>
          </div>
        </div>

        {/* My Projects / Team Projects tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#eeede7', padding: 4, borderRadius: 9, width: 'fit-content' }}>
          <button onClick={() => setTab('mine')} style={tabBtn(tab === 'mine')}>
            My Projects{myCount > 0 ? ` (${myCount})` : ''}
          </button>
          <button onClick={() => setTab('team')} style={tabBtn(tab === 'team')}>
            Team Projects{teamCount > 0 ? ` (${teamCount})` : ''}
          </button>
        </div>

        {error && <p style={{ fontSize: 12, color: '#A32D2D', background: '#FCEBEB', padding: '8px 12px', borderRadius: 6, marginBottom: 16 }}>{error}</p>}
        {info && <p style={{ fontSize: 12, color: '#0F6E56', background: '#E1F5EE', padding: '8px 12px', borderRadius: 6, marginBottom: 16 }}>{info}</p>}
        <input ref={floorPlanInputRef} type="file" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={handleFloorPlanFileChange} />

        {/* New project form */}
        {showNewProject && (
          <form onSubmit={handleCreateProject} style={formCard}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a18' }}>New project</span>
            <input autoFocus value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
              placeholder="e.g. The Blake at the Grove" style={{ ...fieldInput, flex: 1 }} required />
            <button type="submit" disabled={creatingProject} style={primaryBtn}>{creatingProject ? 'Creating…' : 'Create'}</button>
            <button type="button" onClick={() => setShowNewProject(false)} style={ghostBtn}>Cancel</button>
          </form>
        )}

        {/* New survey form */}
        {showNewSurvey && (
          <form onSubmit={handleCreateSurvey} style={{ ...formCard, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a18', width: '100%', marginBottom: 4 }}>New survey</span>
            <input autoFocus value={newSurveyName} onChange={e => setNewSurveyName(e.target.value)}
              placeholder="e.g. Floor 2 — Wing A" style={{ ...fieldInput, flex: 1 }} required />
            <select value={newSurveyProject} onChange={e => setNewSurveyProject(e.target.value)}
              style={{ ...fieldInput, width: 220 }}>
              <option value="">No project (unassigned)</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.user_id !== user.id ? ` (${ownerLabel(p.user_id)})` : ''}
                </option>
              ))}
            </select>
            <button type="submit" disabled={creatingSurvey} style={primaryBtn}>{creatingSurvey ? 'Creating…' : 'Create'}</button>
            <button type="button" onClick={() => setShowNewSurvey(false)} style={ghostBtn}>Cancel</button>
          </form>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Projects with their surveys */}
            {visibleProjects.map(project => {
              const projectSurveys = surveys.filter(s => s.project_id === project.id)
              const isOpen = expanded[project.id]
              const isMine = project.user_id === user.id
              return (
                <div key={project.id} style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: '#f8f8f6' }}
                    onClick={() => setExpanded(e => ({ ...e, [project.id]: !e[project.id] }))}>
                    <i className={`ti ti-chevron-${isOpen ? 'down' : 'right'}`} style={{ fontSize: 14, color: '#888' }} />
                    <i className="ti ti-folder" style={{ fontSize: 16, color: '#534AB7' }} />
                    {editingProjectId === project.id ? (
                      <input
                        autoFocus
                        value={projectNameInput}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setProjectNameInput(e.target.value)}
                        onBlur={() => handleRenameProject(project)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenameProject(project)
                          if (e.key === 'Escape') setEditingProjectId(null)
                        }}
                        style={{ fontSize: 14, fontWeight: 500, color: '#1a1a18', background: '#fff', border: '0.5px solid #378ADD', borderRadius: 6, padding: '2px 7px', outline: 'none', width: 220 }}
                      />
                    ) : (
                      <span
                        onClick={e => {
                          if (!isMine && !isAdmin) return
                          e.stopPropagation()
                          setProjectNameInput(project.name)
                          setEditingProjectId(project.id)
                        }}
                        title={(isMine || isAdmin) ? 'Click to rename' : ''}
                        style={{ fontSize: 14, fontWeight: 500, color: '#1a1a18', cursor: (isMine || isAdmin) ? 'text' : 'default', padding: '2px 5px', borderRadius: 6, border: '0.5px solid transparent' }}
                        onMouseEnter={e => { if (isMine || isAdmin) e.currentTarget.style.borderColor = '#e0dfd8' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent' }}
                      >
                        {project.name}
                        {(isMine || isAdmin) && <i className="ti ti-pencil" style={{ fontSize: 10, color: '#aaa', marginLeft: 5 }} />}
                      </span>
                    )}
                    {!isMine && (
                      <span style={{ fontSize: 10, color: '#888', background: '#eeede7', padding: '2px 7px', borderRadius: 5 }}>
                        {ownerLabel(project.user_id)}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: '#888' }}>{projectSurveys.length} survey{projectSurveys.length !== 1 ? 's' : ''}</span>
                    <button onClick={e => { e.stopPropagation(); triggerFloorPlanUpload(project) }}
                      disabled={uploadingPlanFor === project.id}
                      style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>
                      {uploadingPlanFor === project.id ? 'Uploading…' : '+ Floor plan'}
                    </button>
                    <button onClick={e => { e.stopPropagation(); setNewSurveyProject(project.id); setShowNewSurvey(true) }}
                      style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>+ Survey</button>
                    {isMine && (
                      <button onClick={e => { e.stopPropagation(); openShareModal(project) }}
                        style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>
                        <i className="ti ti-user-plus" style={{ marginRight: 3 }} /> Share
                      </button>
                    )}
                    {isMine && (
                      <button onClick={e => { e.stopPropagation(); handleDeleteProject(project.id, project.name) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 14, padding: '2px 4px' }}>
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: '0.5px solid #e0dfd8' }}>
                      {projectSurveys.length === 0 ? (
                        <div style={{ padding: '14px 20px', fontSize: 12, color: '#aaa' }}>No surveys yet — click "+ Survey" to add one.</div>
                      ) : (
                        projectSurveys.map(s => (
                          <SurveyRow key={s.id} survey={s} ownerLabel={ownerLabel(s.user_id)}
                            onOpen={() => navigate(`/survey/${s.id}`)}
                            onDelete={s.user_id === user.id ? () => handleDeleteSurvey(s.id, s.name) : null} />
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Unassigned surveys */}
            {visibleUnassigned.length > 0 && (
              <div style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', background: '#f8f8f6', borderBottom: '0.5px solid #e0dfd8', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="ti ti-layout-list" style={{ fontSize: 14, color: '#888' }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#888' }}>Unassigned surveys</span>
                </div>
                {visibleUnassigned.map(s => (
                  <SurveyRow key={s.id} survey={s} ownerLabel={ownerLabel(s.user_id)}
                    onOpen={() => navigate(`/survey/${s.id}`)}
                    onDelete={s.user_id === user.id ? () => handleDeleteSurvey(s.id, s.name) : null} />
                ))}
              </div>
            )}

            {visibleProjects.length === 0 && visibleUnassigned.length === 0 && (
              <div style={{ textAlign: 'center', padding: 64, color: '#888' }}>
                <i className="ti ti-map-2" style={{ fontSize: 40, opacity: 0.25, display: 'block', marginBottom: 12 }} />
                <p style={{ fontSize: 14, margin: 0 }}>
                  {tab === 'mine'
                    ? 'Create a project to organize your surveys by building, then add floors as surveys inside.'
                    : 'No team projects yet. Anything a teammate or contractor creates will show up here.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {shareProject && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) setShareProject(null) }}>
          <div style={{ background: '#fff', borderRadius: 12, width: 400, border: '0.5px solid #e0dfd8', padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a18', margin: 0 }}>Share "{shareProject.name}"</h2>
              <button onClick={() => setShareProject(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 16 }}>
                <i className="ti ti-x" />
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 16px' }}>
              Invited contractors will only see this project — not your whole team's projects. Staff accounts (no access limit set) already see everything, so inviting them here isn't necessary. We'll email them a signup/login link automatically.
            </p>

            <form onSubmit={handleInvite} style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <input type="email" required placeholder="contractor@email.com" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                style={{ flex: 1, padding: '7px 10px', fontSize: 13, border: '0.5px solid #ccc', borderRadius: 8, outline: 'none' }} />
              <button type="submit" disabled={inviting} style={primaryBtn}>{inviting ? 'Inviting…' : 'Invite'}</button>
            </form>
            {inviteError && <p style={{ fontSize: 12, color: '#A32D2D', background: '#FCEBEB', padding: '7px 10px', borderRadius: 6, marginBottom: 12 }}>{inviteError}</p>}
            {inviteInfo && <p style={{ fontSize: 12, color: '#0F6E56', background: '#E1F5EE', padding: '7px 10px', borderRadius: 6, marginBottom: 12 }}>{inviteInfo}</p>}

            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 }}>
              Invited ({members.length})
            </div>
            {loadingMembers ? (
              <p style={{ fontSize: 12, color: '#888' }}>Loading…</p>
            ) : members.length === 0 ? (
              <p style={{ fontSize: 12, color: '#aaa' }}>No one invited yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {members.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8f8f6', border: '0.5px solid #e0dfd8', borderRadius: 7, padding: '6px 10px' }}>
                    <span style={{ fontSize: 12.5, color: '#1a1a18' }}>{m.email}</span>
                    <button onClick={() => handleRemoveMember(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A32D2D', fontSize: 11 }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SurveyRow({ survey, onOpen, onDelete, ownerLabel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '11px 16px 11px 40px', borderBottom: '0.5px solid #f0efea' }}>
      <i className="ti ti-map" style={{ fontSize: 14, color: '#888', marginRight: 10 }} />
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#1a1a18' }}>
          {survey.name}
          {ownerLabel && (
            <span style={{ marginLeft: 8, fontSize: 10, color: '#888', background: '#eeede7', padding: '2px 7px', borderRadius: 5, fontWeight: 400 }}>
              {ownerLabel}
            </span>
          )}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#aaa' }}>
          Updated {new Date(survey.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {survey.floor_plan_url && <span style={{ marginLeft: 8, color: '#1D9E75' }}>✓ Floor plan</span>}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onOpen} style={primaryBtn}>Open</button>
        {onDelete && <button onClick={onDelete} style={{ ...ghostBtn, color: '#A32D2D', borderColor: '#F09595' }}>Delete</button>}
      </div>
    </div>
  )
}

function tabBtn(active) {
  return {
    padding: '6px 16px', fontSize: 12.5, fontWeight: 500, borderRadius: 7, border: 'none', cursor: 'pointer',
    background: active ? '#fff' : 'transparent', color: active ? '#1a1a18' : '#888',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
  }
}

const primaryBtn = { padding: '6px 14px', background: '#378ADD', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer' }
const ghostBtn = { padding: '6px 14px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 12, cursor: 'pointer' }
const fieldInput = { padding: '7px 10px', fontSize: 13, border: '0.5px solid #ccc', borderRadius: 8, outline: 'none', background: '#fff', color: '#1a1a18', boxSizing: 'border-box' }
const formCard = { background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }

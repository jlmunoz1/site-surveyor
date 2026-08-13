import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  getSurveys, createSurvey, deleteSurvey, signOut,
  getProjects, createProject, deleteProject, getProfiles,
} from '../lib/supabase'

export default function Dashboard() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [surveys, setSurveys] = useState([])
  const [projects, setProjects] = useState([])
  const [profiles, setProfiles] = useState({}) // id -> { email, full_name }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
    const { error } = await createProject(user.id, newProjectName.trim())
    if (error) { setError(error.message); setCreatingProject(false); return }
    setNewProjectName(''); setShowNewProject(false); setCreatingProject(false)
    loadAll()
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
                    <span style={{ fontSize: 14, fontWeight: 500, color: '#1a1a18' }}>{project.name}</span>
                    {!isMine && (
                      <span style={{ fontSize: 10, color: '#888', background: '#eeede7', padding: '2px 7px', borderRadius: 5 }}>
                        {ownerLabel(project.user_id)}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: '#888' }}>{projectSurveys.length} survey{projectSurveys.length !== 1 ? 's' : ''}</span>
                    <button onClick={e => { e.stopPropagation(); setNewSurveyProject(project.id); setShowNewSurvey(true) }}
                      style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>+ Survey</button>
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

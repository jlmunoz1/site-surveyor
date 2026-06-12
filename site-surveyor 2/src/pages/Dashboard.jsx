import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getSurveys, createSurvey, deleteSurvey, signOut, supabase } from '../lib/supabase'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [surveys, setSurveys] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
    const [{ data: survData }, { data: projData }] = await Promise.all([
      getSurveys(user.id),
      supabase.from('projects').select('*').eq('user_id', user.id).order('name')
    ])
    setSurveys(survData || [])
    setProjects(projData || [])
    // Auto-expand all projects
    const exp = {}
    ;(projData || []).forEach(p => { exp[p.id] = true })
    setExpanded(exp)
    setLoading(false)
  }

  async function handleCreateProject(e) {
    e.preventDefault()
    if (!newProjectName.trim()) return
    setCreatingProject(true)
    const { error } = await supabase.from('projects').insert({ user_id: user.id, name: newProjectName.trim() })
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
    await supabase.from('projects').delete().eq('id', id)
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

  // Group surveys
  const unassigned = surveys.filter(s => !s.project_id)
  const displayName = user?.user_metadata?.full_name || user?.email

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
          <button onClick={handleSignOut} style={ghostBtn}>Sign out</button>
        </div>
      </nav>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
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
              style={{ ...fieldInput, width: 180 }}>
              <option value="">No project (unassigned)</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
            {projects.map(project => {
              const projectSurveys = surveys.filter(s => s.project_id === project.id)
              const isOpen = expanded[project.id]
              return (
                <div key={project.id} style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: '#f8f8f6' }}
                    onClick={() => setExpanded(e => ({ ...e, [project.id]: !e[project.id] }))}>
                    <i className={`ti ti-chevron-${isOpen ? 'down' : 'right'}`} style={{ fontSize: 14, color: '#888' }} />
                    <i className="ti ti-folder" style={{ fontSize: 16, color: '#534AB7' }} />
                    <span style={{ fontSize: 14, fontWeight: 500, color: '#1a1a18', flex: 1 }}>{project.name}</span>
                    <span style={{ fontSize: 11, color: '#888' }}>{projectSurveys.length} survey{projectSurveys.length !== 1 ? 's' : ''}</span>
                    <button onClick={e => { e.stopPropagation(); setNewSurveyProject(project.id); setShowNewSurvey(true) }}
                      style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>+ Survey</button>
                    <button onClick={e => { e.stopPropagation(); handleDeleteProject(project.id, project.name) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 14, padding: '2px 4px' }}>
                      <i className="ti ti-trash" />
                    </button>
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: '0.5px solid #e0dfd8' }}>
                      {projectSurveys.length === 0 ? (
                        <div style={{ padding: '14px 20px', fontSize: 12, color: '#aaa' }}>No surveys yet — click "+ Survey" to add one.</div>
                      ) : (
                        projectSurveys.map(s => <SurveyRow key={s.id} survey={s} onOpen={() => navigate(`/survey/${s.id}`)} onDelete={() => handleDeleteSurvey(s.id, s.name)} />)
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Unassigned surveys */}
            {unassigned.length > 0 && (
              <div style={{ background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', background: '#f8f8f6', borderBottom: '0.5px solid #e0dfd8', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="ti ti-layout-list" style={{ fontSize: 14, color: '#888' }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#888' }}>Unassigned surveys</span>
                </div>
                {unassigned.map(s => <SurveyRow key={s.id} survey={s} onOpen={() => navigate(`/survey/${s.id}`)} onDelete={() => handleDeleteSurvey(s.id, s.name)} />)}
              </div>
            )}

            {projects.length === 0 && surveys.length === 0 && (
              <div style={{ textAlign: 'center', padding: 64, color: '#888' }}>
                <i className="ti ti-map-2" style={{ fontSize: 40, opacity: 0.25, display: 'block', marginBottom: 12 }} />
                <p style={{ fontSize: 14, margin: 0 }}>Create a project to organize your surveys by building, then add floors as surveys inside.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SurveyRow({ survey, onOpen, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '11px 16px 11px 40px', borderBottom: '0.5px solid #f0efea' }}>
      <i className="ti ti-map" style={{ fontSize: 14, color: '#888', marginRight: 10 }} />
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#1a1a18' }}>{survey.name}</p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#aaa' }}>
          Updated {new Date(survey.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {survey.floor_plan_url && <span style={{ marginLeft: 8, color: '#1D9E75' }}>✓ Floor plan</span>}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onOpen} style={primaryBtn}>Open</button>
        <button onClick={onDelete} style={{ ...ghostBtn, color: '#A32D2D', borderColor: '#F09595' }}>Delete</button>
      </div>
    </div>
  )
}

const primaryBtn = { padding: '6px 14px', background: '#378ADD', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer' }
const ghostBtn = { padding: '6px 14px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 12, cursor: 'pointer' }
const fieldInput = { padding: '7px 10px', fontSize: 13, border: '0.5px solid #ccc', borderRadius: 8, outline: 'none', background: '#fff', color: '#1a1a18', boxSizing: 'border-box' }
const formCard = { background: '#fff', border: '0.5px solid #e0dfd8', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { v4 as uuidv4 } from 'uuid'
import { getPdfPageCount } from '../lib/pdf'
import {
  getSurveys, createSurvey, deleteSurvey, signOut,
  getProjects, createProject, deleteProject, getProfiles, renameProject, updateProjectAddress,
  syncProjectToPortMapper, setProjectPortMapperSiteId,
  uploadFloorPlan, saveSurvey,
  getProjectMembers, inviteToProject, removeProjectMember, sendProjectInviteEmail,
  getEnterprises, createEnterprise, renameEnterprise, deleteEnterprise, setProjectEnterprise,
} from '../lib/supabase'
import { geocodeAddress } from '../lib/geocode'

export default function Dashboard() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [surveys, setSurveys] = useState([])
  const [projects, setProjects] = useState([])
  const [enterprises, setEnterprises] = useState([])
  const [expandedEnterprises, setExpandedEnterprises] = useState({}) // default-open; only tracks explicit collapses
  const [showNewEnterprise, setShowNewEnterprise] = useState(false)
  const [newEnterpriseName, setNewEnterpriseName] = useState('')
  const [creatingEnterprise, setCreatingEnterprise] = useState(false)
  const [editingEnterpriseId, setEditingEnterpriseId] = useState(null)
  const [enterpriseNameInput, setEnterpriseNameInput] = useState('')
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
  const [folderImportProgress, setFolderImportProgress] = useState(null) // { projectId, done, total } while a batch import is running

  // Click-to-edit project name — mirrors the survey editor's rename
  // pattern (click name, edit inline, blur/Enter to save).
  const [editingProjectId, setEditingProjectId] = useState(null)
  const [projectNameInput, setProjectNameInput] = useState('')

  // Site address, editable per project — geocoded on save so the
  // georeferencing map can jump straight to the right building.
  const [editingAddressId, setEditingAddressId] = useState(null)
  const [addressInput, setAddressInput] = useState('')
  const [geocodingAddressId, setGeocodingAddressId] = useState(null) // project id currently being geocoded, or null
  const [shareProject, setShareProject] = useState(null) // project object currently being shared
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteInfo, setInviteInfo] = useState('')
  const floorPlanInputRef = useRef(null)
  const folderImportInputRef = useRef(null)
  const pendingProjectRef = useRef(null)

  useEffect(() => {
    if (user) loadAll()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true)
    const [{ data: survData }, { data: projData }, { data: profData }, { data: entData }] = await Promise.all([
      getSurveys(),
      getProjects(),
      getProfiles(),
      getEnterprises(),
    ])
    setSurveys(survData || [])
    setProjects(projData || [])
    setEnterprises(entData || [])
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

  async function handleSaveAddress(project) {
    const trimmed = addressInput.trim()
    setEditingAddressId(null)
    if (trimmed === (project.address || '')) return

    if (!trimmed) {
      // Cleared the address entirely — no need to geocode anything.
      const { error } = await updateProjectAddress(project.id, '', null, null)
      if (error) { setError('Could not clear address: ' + error.message); return }
      setProjects(ps => ps.map(p => p.id === project.id ? { ...p, address: '', address_lat: null, address_lng: null } : p))
      return
    }

    setGeocodingAddressId(project.id)
    const { lat, lng, error: geoError } = await geocodeAddress(trimmed)
    setGeocodingAddressId(null)
    if (geoError) {
      // Still save the typed address even if geocoding failed, so it's
      // not lost — just without map coordinates yet. The georeference
      // page will retry geocoding it live if lat/lng are missing.
      setError(`Couldn't locate that address on the map (${geoError.message}). Saved the text anyway — you can fix it or geocode again later.`)
      const { error } = await updateProjectAddress(project.id, trimmed, null, null)
      if (!error) setProjects(ps => ps.map(p => p.id === project.id ? { ...p, address: trimmed, address_lat: null, address_lng: null } : p))
      return
    }

    const { error } = await updateProjectAddress(project.id, trimmed, lat, lng)
    if (error) { setError('Could not save address: ' + error.message); return }
    setProjects(ps => ps.map(p => p.id === project.id ? { ...p, address: trimmed, address_lat: lat, address_lng: lng } : p))
  }

  async function handleCreateEnterprise(e) {
    e.preventDefault()
    if (!newEnterpriseName.trim()) return
    setCreatingEnterprise(true)
    const { data, error } = await createEnterprise(user.id, newEnterpriseName.trim())
    setCreatingEnterprise(false)
    if (error) { setError('Could not create enterprise: ' + error.message); return }
    setEnterprises(es => [...es, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewEnterpriseName(''); setShowNewEnterprise(false)
  }

  async function handleRenameEnterprise(enterprise) {
    const trimmed = enterpriseNameInput.trim()
    setEditingEnterpriseId(null)
    if (!trimmed || trimmed === enterprise.name) return
    const previousName = enterprise.name
    setEnterprises(es => es.map(x => x.id === enterprise.id ? { ...x, name: trimmed } : x))
    const { error } = await renameEnterprise(enterprise.id, trimmed)
    if (error) {
      setEnterprises(es => es.map(x => x.id === enterprise.id ? { ...x, name: previousName } : x))
      setError('Rename failed: ' + error.message)
    }
  }

  async function handleDeleteEnterprise(enterprise) {
    const count = projects.filter(p => p.enterprise_id === enterprise.id).length
    const warning = count > 0
      ? `Delete "${enterprise.name}"? Its ${count} project${count !== 1 ? 's' : ''} will move to Unassigned, not be deleted.`
      : `Delete "${enterprise.name}"?`
    if (!window.confirm(warning)) return
    const { error } = await deleteEnterprise(enterprise.id)
    if (error) { setError('Could not delete enterprise: ' + error.message); return }
    setEnterprises(es => es.filter(x => x.id !== enterprise.id))
    setProjects(ps => ps.map(p => p.enterprise_id === enterprise.id ? { ...p, enterprise_id: null } : p))
  }

  async function handleMoveProjectToEnterprise(project, enterpriseId) {
    const previous = project.enterprise_id ?? null
    setProjects(ps => ps.map(p => p.id === project.id ? { ...p, enterprise_id: enterpriseId } : p))
    const { error } = await setProjectEnterprise(project.id, enterpriseId)
    if (error) {
      setProjects(ps => ps.map(p => p.id === project.id ? { ...p, enterprise_id: previous } : p))
      setError('Could not move project: ' + error.message)
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

  function triggerFolderImport(project) {
    pendingProjectRef.current = project
    folderImportInputRef.current.click()
  }

  // Imports every floor plan file found in a selected folder (or
  // multi-select) in one go — one survey per file, with the same
  // per-file "split a multi-page PDF into one survey per floor" logic
  // handleFloorPlanFileChange already applies to a single upload.
  // Runs sequentially rather than in parallel so a slow/large file
  // doesn't race the DB writes for the ones before it, and so progress
  // can be reported file-by-file.
  async function handleFolderImportChange(e) {
    const rawFiles = Array.from(e.target.files || [])
    e.target.value = ''
    const project = pendingProjectRef.current
    pendingProjectRef.current = null
    if (!rawFiles.length || !project) return

    // A folder picker returns everything in the folder, not just floor
    // plans — filter down to images/PDFs and skip OS clutter like
    // .DS_Store or Thumbs.db, then process in a stable, readable order.
    const files = rawFiles
      .filter(f => f.type === 'application/pdf' || f.type.startsWith('image/') || /\.(pdf|png|jpe?g|gif|webp)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    if (!files.length) { setError('No image or PDF files found in that folder'); return }

    setError(''); setInfo('')
    setFolderImportProgress({ projectId: project.id, done: 0, total: files.length })

    let totalCreated = 0
    let filesWithErrors = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setFolderImportProgress({ projectId: project.id, done: i, total: files.length })
      const tempId = uuidv4()
      const { url, error: uploadErr } = await uploadFloorPlan(tempId, file)
      if (uploadErr) { filesWithErrors.push(file.name); continue }

      const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      let pageCount = 1
      if (isPDF) {
        try { pageCount = await getPdfPageCount(url) } catch (err) { console.warn(`Could not read page count for ${file.name}:`, err) }
      }

      const baseName = file.name.replace(/\.[^.]+$/, '')
      for (let p = 1; p <= pageCount; p++) {
        const name = pageCount > 1 ? `${baseName} — Floor ${p}` : baseName
        const { data: newSurvey, error: createErr } = await createSurvey(user.id, name, project.id)
        if (createErr || !newSurvey) { console.warn(`Couldn't create survey for ${file.name} (page ${p}):`, createErr); continue }
        const { error: saveErr } = await saveSurvey(newSurvey.id, { floor_plan_url: url, floor_plan_page: p })
        if (!saveErr) totalCreated++
      }
    }

    setFolderImportProgress(null)
    const skipped = filesWithErrors.length
    setInfo(skipped === 0
      ? `Imported ${totalCreated} survey${totalCreated !== 1 ? 's' : ''} from ${files.length} file${files.length !== 1 ? 's' : ''}`
      : `Imported ${totalCreated} survey${totalCreated !== 1 ? 's' : ''} — ${skipped} file${skipped !== 1 ? 's' : ''} failed to upload (${filesWithErrors.join(', ')})`)
    setTimeout(() => setInfo(''), skipped ? 8000 : 4000)
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
            <button onClick={() => setShowNewEnterprise(true)} style={ghostBtn}>
              <i className="ti ti-building-skyscraper" style={{ marginRight: 4 }} /> New enterprise
            </button>
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
        <input ref={folderImportInputRef} type="file" webkitdirectory="" directory="" multiple accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={handleFolderImportChange} />

        {/* New enterprise form */}
        {showNewEnterprise && (
          <form onSubmit={handleCreateEnterprise} style={formCard}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a18' }}>New enterprise</span>
            <input autoFocus value={newEnterpriseName} onChange={e => setNewEnterpriseName(e.target.value)}
              placeholder="e.g. Sage Health" style={{ ...fieldInput, flex: 1 }} required />
            <button type="submit" disabled={creatingEnterprise} style={primaryBtn}>{creatingEnterprise ? 'Creating…' : 'Create'}</button>
            <button type="button" onClick={() => setShowNewEnterprise(false)} style={ghostBtn}>Cancel</button>
          </form>
        )}

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

            {/* Projects with their surveys, grouped by Enterprise */}
            {(() => {
              function renderProject(project) {
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
                    {(isMine || isAdmin) && enterprises.length > 0 && (
                      <select
                        value={project.enterprise_id || ''}
                        onClick={e => e.stopPropagation()}
                        onChange={e => handleMoveProjectToEnterprise(project, e.target.value || null)}
                        title="Move to enterprise"
                        style={{ fontSize: 10.5, color: '#666', border: '0.5px solid #ddd', borderRadius: 5, padding: '3px 5px', background: '#fff' }}
                      >
                        <option value="">Unassigned</option>
                        {enterprises.map(ent => (
                          <option key={ent.id} value={ent.id}>{ent.name}</option>
                        ))}
                      </select>
                    )}
                    <span style={{ fontSize: 11, color: '#888' }}>{projectSurveys.length} survey{projectSurveys.length !== 1 ? 's' : ''}</span>
                    <button onClick={e => { e.stopPropagation(); triggerFloorPlanUpload(project) }}
                      disabled={uploadingPlanFor === project.id}
                      style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>
                      {uploadingPlanFor === project.id ? 'Uploading…' : '+ Floor plan'}
                    </button>
                    <button onClick={e => { e.stopPropagation(); triggerFolderImport(project) }}
                      disabled={folderImportProgress?.projectId === project.id}
                      title="Select a folder of floor plans (PDFs/images) and create one survey per file"
                      style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>
                      {folderImportProgress?.projectId === project.id
                        ? `Importing ${folderImportProgress.done + 1}/${folderImportProgress.total}…`
                        : (<><i className="ti ti-folder-plus" style={{ marginRight: 3 }} /> Import folder</>)}
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
                  {(project.address || editingAddressId === project.id) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 16px 8px 40px', fontSize: 11, color: '#888', background: '#f8f8f6' }}>
                      <i className="ti ti-map-pin" style={{ fontSize: 12 }} />
                      {editingAddressId === project.id ? (
                        <input
                          autoFocus
                          value={addressInput}
                          placeholder="123 Main St, City, State"
                          onChange={e => setAddressInput(e.target.value)}
                          onBlur={() => handleSaveAddress(project)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveAddress(project)
                            if (e.key === 'Escape') setEditingAddressId(null)
                          }}
                          style={{ fontSize: 11, color: '#444', background: '#fff', border: '0.5px solid #378ADD', borderRadius: 5, padding: '3px 7px', outline: 'none', width: 280 }}
                        />
                      ) : (
                        <span
                          onClick={() => { if (!isMine && !isAdmin) return; setAddressInput(project.address || ''); setEditingAddressId(project.id) }}
                          title={(isMine || isAdmin) ? 'Click to edit address' : ''}
                          style={{ cursor: (isMine || isAdmin) ? 'text' : 'default' }}
                        >
                          {project.address}
                          {project.address_lat == null && <span style={{ color: '#BA7517', marginLeft: 6 }}>(not located on map yet)</span>}
                        </span>
                      )}
                      {geocodingAddressId === project.id && <span style={{ color: '#378ADD' }}>Locating…</span>}
                    </div>
                  )}
                  {!project.address && editingAddressId !== project.id && (isMine || isAdmin) && (
                    <div style={{ padding: '2px 16px 6px 40px', background: '#f8f8f6' }}>
                      <button
                        onClick={() => { setAddressInput(''); setEditingAddressId(project.id) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 11, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <i className="ti ti-map-pin-plus" style={{ fontSize: 12 }} /> Add site address
                      </button>
                    </div>
                  )}
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
          }

          // Group this tab's visible projects by enterprise — named
          // enterprises first (alphabetical, matching the fetch order),
          // then an "Unassigned" bucket for projects with no
          // enterprise_id. Enterprises with zero visible projects in
          // this tab are skipped entirely rather than shown empty,
          // since "My Projects" vs "Team Projects" already filters by
          // ownership underneath this grouping.
          const enterpriseSections = enterprises
            .map(ent => ({ enterprise: ent, projects: visibleProjects.filter(p => p.enterprise_id === ent.id) }))
            .filter(section => section.projects.length > 0)
          const unassignedProjects = visibleProjects.filter(p => !p.enterprise_id)

          return (
            <>
              {enterpriseSections.map(({ enterprise, projects: entProjects }) => {
                const isEntOpen = expandedEnterprises[enterprise.id] !== false // default open
                const isEntMine = enterprise.user_id === user.id
                return (
                  <div key={enterprise.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px', cursor: 'pointer' }}
                      onClick={() => setExpandedEnterprises(e => ({ ...e, [enterprise.id]: !isEntOpen }))}>
                      <i className={`ti ti-chevron-${isEntOpen ? 'down' : 'right'}`} style={{ fontSize: 13, color: '#888' }} />
                      <i className="ti ti-building-skyscraper" style={{ fontSize: 15, color: '#0F6E56' }} />
                      {editingEnterpriseId === enterprise.id ? (
                        <input
                          autoFocus
                          value={enterpriseNameInput}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setEnterpriseNameInput(e.target.value)}
                          onBlur={() => handleRenameEnterprise(enterprise)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameEnterprise(enterprise)
                            if (e.key === 'Escape') setEditingEnterpriseId(null)
                          }}
                          style={{ fontSize: 13, fontWeight: 600, color: '#1a1a18', background: '#fff', border: '0.5px solid #378ADD', borderRadius: 6, padding: '2px 7px', outline: 'none', width: 220 }}
                        />
                      ) : (
                        <span
                          onClick={e => {
                            if (!isEntMine && !isAdmin) return
                            e.stopPropagation()
                            setEnterpriseNameInput(enterprise.name)
                            setEditingEnterpriseId(enterprise.id)
                          }}
                          title={(isEntMine || isAdmin) ? 'Click to rename' : ''}
                          style={{ fontSize: 13, fontWeight: 600, color: '#1a1a18', textTransform: 'uppercase', letterSpacing: '.03em', cursor: (isEntMine || isAdmin) ? 'text' : 'default' }}
                        >
                          {enterprise.name}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: '#aaa' }}>{entProjects.length} project{entProjects.length !== 1 ? 's' : ''}</span>
                      <span style={{ flex: 1 }} />
                      <button onClick={e => { e.stopPropagation(); navigate(`/enterprise/${enterprise.id}/export`) }}
                        style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>
                        <i className="ti ti-download" style={{ marginRight: 3 }} /> Download all PDFs
                      </button>
                      {(isEntMine || isAdmin) && (
                        <button onClick={e => { e.stopPropagation(); handleDeleteEnterprise(enterprise) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 13, padding: '2px 4px' }}>
                          <i className="ti ti-trash" />
                        </button>
                      )}
                    </div>
                    {isEntOpen && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 18 }}>
                        {entProjects.map(renderProject)}
                      </div>
                    )}
                  </div>
                )
              })}

              {enterpriseSections.length > 0 && unassignedProjects.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 500, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.05em', padding: '4px 4px 0' }}>
                  Unassigned
                </div>
              )}
              {unassignedProjects.map(renderProject)}
            </>
          )
        })()}

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

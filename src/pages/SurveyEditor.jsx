import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSurvey, getSurveyByToken, getSurveys, saveSurvey, createSurvey, uploadFloorPlan, uploadDevicePhoto, createShareToken, getProject, createPortMapperRack, getPortMapperRackDevices, updatePortMapperRackName, getProfileById } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import SurveyCanvas from '../components/SurveyCanvas'
import { DEVICE_DEFS, CABLE_STYLES, DeviceIcon, DEVICE_STATUSES, COLOR_PALETTE } from '../lib/devices'
import { v4 as uuidv4 } from 'uuid'
import { getPdfPageCount, isPdfUrl } from '../lib/pdf'
import { detectDevicesFromPdf } from '../lib/deviceDetection'
import { detectMarkersByColor } from '../lib/colorDetect'
import { buildSurveyPdfBlob, downloadBlob, safeFileName } from '../lib/exportPdf'

// Sage Port Mapper's stable production URL.
const NETWORK_MAPPER_URL = 'https://sage-port-mapper.vercel.app'
const NETWORK_MAPPER_DTYPES = ['mdf', 'idf', 'switch']

function getDeviceDef(dtype) {
  for (const section of DEVICE_DEFS) {
    const item = section.items.find(i => i.dtype === dtype)
    if (item) return item
  }
  return null
}
function getDefaultDeviceColor(dtype) {
  return getDeviceDef(dtype)?.color || null
}

function networkMapperUrl(device) {
  if (!device?.rackId) return NETWORK_MAPPER_URL
  // Adjust this once we know Sage Port Mapper's actual deep-link format
  // (e.g. it might expect /rack/:id or a different param name than ?rack=).
  return `${NETWORK_MAPPER_URL}?rack=${encodeURIComponent(device.rackId)}`
}

export default function SurveyEditor() {
  const { id, token } = useParams()
  const navigate = useNavigate()
  const isShared = Boolean(token)
  const { user } = useAuth()

  const [survey, setSurvey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveError, setSaveError] = useState('') // persistent, inline — never the full-page `error` takeover
  const [error, setError] = useState('')

  // Non-disruptive "someone else changed this since you loaded it"
  // banner. Set only when a save comes back with conflict: true; holds
  // both the server's current copy (`latest`) and the local edits that
  // couldn't be saved (`pending`), so the person can choose to reload,
  // overwrite, or keep their own version as a new survey.
  const [conflict, setConflict] = useState(null)
  const [conflictEditorName, setConflictEditorName] = useState('')

  const [devices, setDevices] = useState([])
  const [cables, setCables] = useState([])
  const [svgMarkup, setSvgMarkup] = useState('')
  const [pxPerFt, setPxPerFt] = useState(4)
  const [floorPlanUrl, setFloorPlanUrl] = useState('')
  const [floorPlanPage, setFloorPlanPage] = useState(1)
  const [floorPlanRotation, setFloorPlanRotation] = useState(0)

  // AI device detection — scans an imported PDF floor plan for markers
  // that are already drawn on it (e.g. a System Surveyor export) and
  // adds them as real, editable devices flagged `unconfirmed: true`
  // until the person reviews and confirms each one below.
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState('')
  const [iconSizes, setIconSizes] = useState({
    cameras: 16,
    lora: 20,
    network: 20,
    access: 16,
  })
  const [labelSizes, setLabelSizes] = useState({
    cameras: 10,
    lora: 13,
    network: 10,
    access: 10,
  })
  // Which specific device types (dtype, not category) currently have
  // their labels hidden — e.g. hiding "Reolink Fisheye" labels while
  // Dome/Bullet camera labels (same category) stay visible. Finer-
  // grained than iconSizes/labelSizes, which only go down to category.
  const [hiddenLabelTypes, setHiddenLabelTypes] = useState([])
  const [exportingPDF, setExportingPDF] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [calibrating, setCalibrating] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const [showCopyScale, setShowCopyScale] = useState(false)
  const [siblingSurveys, setSiblingSurveys] = useState([])
  const [loadingSiblings, setLoadingSiblings] = useState(false)
  const [selectedSiblings, setSelectedSiblings] = useState({})
  const [copyingScale, setCopyingScale] = useState(false)
  const [copyScaleMsg, setCopyScaleMsg] = useState('')
  const [showCalibrateModal, setShowCalibrateModal] = useState(false)
  const [calibrateDistance, setCalibrateDistance] = useState('')
  const [calibratePixels, setCalibratePixels] = useState(0)

  const [mode, setMode] = useState('select')
  const [activeCableType, setActiveCableType] = useState('cat6')
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.8)
  const [selectedId, setSelectedId] = useState(null)
  const [showNetworkMapper, setShowNetworkMapper] = useState(false)
  const [selectedCableId, setSelectedCableId] = useState(null)

  const [showShare, setShowShare] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [showScale, setShowScale] = useState(false)
  const [scaleInput, setScaleInput] = useState('4')
  const [showBOM, setShowBOM] = useState(false)
  const [portMapperSiteId, setPortMapperSiteId] = useState(null)

  const fileInputRef = useRef(null)
  const canvasRef = useRef(null)
  const devicePhotoInputRef = useRef(null)
  const saveTimer = useRef(null)
  // Tracks the updated_at we last loaded/saved successfully — the
  // optimistic-concurrency token passed to saveSurvey. A ref (not state)
  // because scheduleSave's debounce timer needs the latest value without
  // re-subscribing to it on every keystroke/drag.
  const lastKnownUpdatedAt = useRef(null)

  useEffect(() => {
    loadSurvey()
  }, [id, token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSurvey() {
    setLoading(true)
    const { data, error } = token ? await getSurveyByToken(token) : await getSurvey(id)
    if (error || !data) { setError('Survey not found.'); setLoading(false); return }
    setSurvey(data)
    lastKnownUpdatedAt.current = data.updated_at
    setConflict(null)
    setConflictEditorName('')
    setSaveError('')
    setDevices(data.devices || [])
    setCables(data.cables || [])
    setSvgMarkup(data.svg_markup || '')
    setPxPerFt(data.px_per_ft || 4)
    setScaleInput(String(data.px_per_ft || 4))
    setFloorPlanUrl(data.floor_plan_url || '')
    setFloorPlanPage(data.floor_plan_page || 1)
    setFloorPlanRotation(data.floor_plan_rotation || 0)
    // If this survey belongs to a project that's synced to Port Mapper,
    // remember its site id so newly placed MDF/IDF/switches can get a
    // matching rack created automatically.
    if (data.project_id && !isShared) {
      const { data: project } = await getProject(data.project_id)
      if (project?.port_mapper_site_id) setPortMapperSiteId(project.port_mapper_site_id)
    }
    if (data.icon_sizes) {
      setIconSizes(typeof data.icon_sizes === 'object' ? data.icon_sizes : {cameras:16,lora:20,network:20,access:16})
    }
    if (data.label_sizes) {
      setLabelSizes(typeof data.label_sizes === 'object' ? data.label_sizes : {cameras:10,lora:13,network:10,access:10})
    }
    setHiddenLabelTypes(Array.isArray(data.hidden_label_types) ? data.hidden_label_types : [])
    setLoading(false)
  }

  // Single, unified save path for everything — devices, cables, markup,
  // scale, icon sizes, and label sizes all go through here together as
  // one complete snapshot. Previously icon/label size changes fired
  // their own separate, immediate, uncoordinated save calls alongside
  // the debounced one used for everything else — if two independent
  // save requests were in flight at the same time, whichever happened
  // to finish last would win, silently reverting whatever the other
  // one had just saved. Routing every kind of edit through the same
  // debounce timer means there's only ever one save in flight, always
  // carrying the complete, current state.
  // Shared conflict handling for both the debounced autosave and the
  // explicit "Save" button: on a clean save, remember the new
  // updated_at as our concurrency token; on a conflict, surface the
  // banner (and look up who made the other change) instead of retrying
  // or losing the pending edits.
  async function handleConflict(latest, pending) {
    setConflict({ latest, pending })
    setConflictEditorName('')
    if (latest?.updated_by) {
      const { data: profile } = await getProfileById(latest.updated_by)
      if (profile) setConflictEditorName(profile.full_name || profile.email || '')
    }
  }

  const scheduleSave = useCallback((devs, cabs, markup, scale, iSizes, lSizes) => {
    if (isShared) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      const pending = { devices: devs, cables: cabs, svg_markup: markup, px_per_ft: scale, icon_sizes: iSizes, label_sizes: lSizes }
      const { data, error: saveFailure, conflict: hasConflict, latest } = await saveSurvey(id, pending, {
        expectedUpdatedAt: lastKnownUpdatedAt.current,
        updatedBy: user?.id,
      })
      setSaving(false)
      if (hasConflict) { await handleConflict(latest, pending); return }
      // Inline, non-disruptive failure indicator rather than the
      // full-page `error` state — autosave fires repeatedly while
      // someone keeps working, so a takeover here would wipe out the
      // editor on every debounce tick until the underlying permission
      // or connectivity issue is fixed.
      if (saveFailure) { setSaveError(saveFailure.message); return }
      setSaveError('')
      if (data?.[0]?.updated_at) lastKnownUpdatedAt.current = data[0].updated_at
      setSaveMsg('Saved'); setTimeout(() => setSaveMsg(''), 2000)
    }, 1200)
  }, [id, isShared, user])

  // Explicit, immediate save — bypasses the debounce entirely, for
  // when someone wants a definite confirmation right now rather than
  // trusting the auto-save timer (e.g. after manually nudging a
  // device back into place following the coordinate-system fix).
  async function handleSaveNow() {
    if (isShared) return
    clearTimeout(saveTimer.current)
    setSaving(true)
    const pending = { devices, cables, svg_markup: svgMarkup, px_per_ft: pxPerFt, icon_sizes: iconSizes, label_sizes: labelSizes }
    const { data, error: saveFailure, conflict: hasConflict, latest } = await saveSurvey(id, pending, {
      expectedUpdatedAt: lastKnownUpdatedAt.current,
      updatedBy: user?.id,
    })
    setSaving(false)
    if (hasConflict) { await handleConflict(latest, pending); return }
    if (saveFailure) { setSaveError(saveFailure.message); return }
    setSaveError('')
    if (data?.[0]?.updated_at) lastKnownUpdatedAt.current = data[0].updated_at
    setSaveMsg('Saved'); setTimeout(() => setSaveMsg(''), 2000)
  }

  // ── Conflict resolution ──────────────────────────────────────────────
  // "Load their version" — discard the pending local edit and refetch,
  // so the person sees exactly what's on the server before deciding
  // whether to redo their change on top of it.
  async function resolveConflictReload() {
    setConflict(null)
    setSaveError('')
    await loadSurvey()
  }

  // "Keep mine" — save the pending edits anyway, deliberately skipping
  // the expectedUpdatedAt check this time so it's not rejected again.
  // This does overwrite the other person's change; it's an explicit,
  // informed choice rather than the silent overwrite we're trying to
  // prevent. Still checked for a silent zero-row failure (e.g. RLS)
  // rather than trusting `!error` alone — that's exactly the bug that
  // let a previous "Overwrite theirs" click report success when it
  // hadn't actually written anything.
  async function resolveConflictOverwrite() {
    const pending = conflict?.pending
    if (!pending) return
    setConflict(null)
    setSaving(true)
    const { data, error: saveFailure } = await saveSurvey(id, pending, { updatedBy: user?.id })
    setSaving(false)
    if (saveFailure) { setSaveError(saveFailure.message); return }
    setSaveError('')
    if (data?.[0]?.updated_at) lastKnownUpdatedAt.current = data[0].updated_at
    setSaveMsg('Saved (overwrote their changes)'); setTimeout(() => setSaveMsg(''), 3000)
  }

  // "Save as a copy" — keeps both versions: the server keeps whatever
  // the other person saved, and the pending local edits land in a brand
  // new survey the person is redirected into.
  async function resolveConflictSaveCopy() {
    const pending = conflict?.pending
    if (!pending || !user?.id) return
    setSaving(true)
    const { data: newSurvey, error: createError } = await createSurvey(
      user.id,
      `${survey?.name || 'Survey'} (your copy)`,
      survey?.project_id || null
    )
    if (createError || !newSurvey) {
      setSaving(false)
      setSaveError('Could not create a copy: ' + (createError?.message || 'unknown error'))
      return
    }
    const { error: copySaveError } = await saveSurvey(newSurvey.id, pending, { updatedBy: user?.id })
    setSaving(false)
    if (copySaveError) {
      // The (empty) copy record exists, but writing the pending edits
      // into it failed. Deliberately don't navigate there — that would
      // trigger this editor's load-on-id-change effect and overwrite
      // our still-unsaved local edits with the empty copy fetched from
      // the server. Keep the conflict banner up instead so the person
      // can retry or pick a different resolution without losing work.
      setSaveError('Could not save your edits into the copy: ' + copySaveError.message)
      setConflict({ latest: conflict.latest, pending })
      return
    }
    setConflict(null)
    navigate(`/survey/${newSurvey.id}`)
  }

  function updateDevices(newDevs) { setDevices(newDevs); scheduleSave(newDevs, cables, svgMarkup, pxPerFt, iconSizes, labelSizes) }
  function applyGlobalAOCColor(color) {
    updateDevices(devices.map(d => d.dtype === 'rak-gw' ? { ...d, hmFillColor: color } : d))
  }
  function applyGlobalAOCRange(rangeFt) {
    updateDevices(devices.map(d => d.dtype === 'rak-gw' ? { ...d, hmRangeFt: rangeFt } : d))
  }
  function updateCables(newCabs) { setCables(newCabs); scheduleSave(devices, newCabs, svgMarkup, pxPerFt, iconSizes, labelSizes) }
  function updateMarkup(m) { setSvgMarkup(m); scheduleSave(devices, cables, m, pxPerFt, iconSizes, labelSizes) }
  function updateScale(s) { setPxPerFt(s); scheduleSave(devices, cables, svgMarkup, s, iconSizes, labelSizes) }
  function updateIconSize(category, s) {
    const v = Math.max(4, Math.min(80, s))
    const newSizes = { ...iconSizes, [category]: v }
    setIconSizes(newSizes)
    scheduleSave(devices, cables, svgMarkup, pxPerFt, newSizes, labelSizes)
  }
  function updateLabelSize(category, s) {
    const v = Math.max(6, Math.min(60, s))
    const newSizes = { ...labelSizes, [category]: v }
    setLabelSizes(newSizes)
    scheduleSave(devices, cables, svgMarkup, pxPerFt, iconSizes, newSizes)
  }

  function handleDeviceAdd(data) {
    const d = { ...data, id: uuidv4(), model: '', ip: '', notes: '', cost: 0, qty: 1, status: 'existing', photoUrl: '' }
    updateDevices([...devices, d])
    setSelectedId(d.id); setSelectedCableId(null)
    // Best-effort: auto-create a matching rack in Port Mapper for
    // MDF/IDF/switch devices, if this survey's project is synced there.
    // Once created, remember its rack id on the device so we can pull
    // its equipment list back into Site Surveyor later.
    if (NETWORK_MAPPER_DTYPES.includes(d.dtype) && portMapperSiteId) {
      createPortMapperRack(portMapperSiteId, d.rackId || d.label).then(({ rack, error }) => {
        if (error) { console.warn('Port Mapper rack sync failed:', error); return }
        if (rack?.id) patchDeviceById(d.id, { portMapperRackId: rack.id })
      })
    }
  }
  const unconfirmedDevices = devices.filter(d => d.unconfirmed)
  const isPdfFloorPlan = isPdfUrl(floorPlanUrl)

  // Free, instant, no-API-key detection — matches the known marker
  // color used by tools like System Surveyor and clusters matches into
  // blobs. Finds WHERE markers are; can't read the "GW 74" text next
  // to them, so detected devices default to Gateway (rak-gw, the type
  // this color is actually used for on real exports) with a blank
  // label for the person to fill in during review.
  async function handleDetectDevicesByColor(urlOverride, pageOverride) {
    // Defensive: only accept a real string override — guards against a
    // handler being wired directly to onClick, which would otherwise
    // pass the DOM click event itself as urlOverride.
    const url = (typeof urlOverride === 'string' && urlOverride) || floorPlanUrl
    const page = (typeof pageOverride === 'number' && pageOverride) || floorPlanPage
    if (!url) return
    setDetecting(true); setDetectError('')
    const { markers, error } = await detectMarkersByColor(url, page)
    setDetecting(false)
    if (error) { setDetectError(error); return }
    if (!markers.length) {
      setSaveMsg('No matching purple markers found on this page')
      setTimeout(() => setSaveMsg(''), 3500)
      return
    }
    const def = getDeviceDef('rak-gw')
    const newDevices = markers.map(m => ({
      id: uuidv4(),
      dtype: 'rak-gw', label: '', color: def?.color || '#3B6D11',
      coverage: def?.coverage || 0, heatmap: def?.heatmap || false,
      x: m.x - 19, y: m.y - 19,
      model: '', ip: '', notes: '', cost: 0, qty: 1, status: 'existing', photoUrl: '',
      hmRangeFt: 120, hmStrength: 0.75,
      unconfirmed: true,
      // A soft patch drawn behind the icon (see SurveyCanvas) to cover
      // the original flattened marker pixels underneath — sized to the
      // actual detected blob plus generous padding, since the original
      // export's icon+label combo is usually wider than just the dot.
      // Capped as well as floored — a bad detection shouldn't be able
      // to produce a patch bigger than a couple of marker-widths, even
      // if the size math upstream ever misbehaves.
      maskW: Math.min(Math.max(m.width, 24) + 34, 140),
      maskH: Math.min(Math.max(m.height, 24) + 34, 140),
    }))
    updateDevices([...devices, ...newDevices])
    setSaveMsg(`Detected ${newDevices.length} marker${newDevices.length === 1 ? '' : 's'} by color — review the highlighted devices below (labeled as Gateways by default, retype if any are actually IDF/MDF)`)
    setTimeout(() => setSaveMsg(''), 6000)
  }

  async function handleDetectDevices(urlOverride, pageOverride) {
    // Defensive: only accept a real string override — guards against a
    // handler being wired directly to onClick, which would otherwise
    // pass the DOM click event itself as urlOverride.
    const url = (typeof urlOverride === 'string' && urlOverride) || floorPlanUrl
    const page = (typeof pageOverride === 'number' && pageOverride) || floorPlanPage
    if (!url) return
    setDetecting(true); setDetectError('')
    const { markers, error } = await detectDevicesFromPdf(url, page)
    setDetecting(false)
    if (error) { setDetectError(error); return }
    if (!markers.length) {
      setSaveMsg('No existing device markers detected on this page')
      setTimeout(() => setSaveMsg(''), 3500)
      return
    }
    const newDevices = markers.map(m => {
      const def = getDeviceDef(m.dtype) || getDeviceDef('sage-equip')
      return {
        id: uuidv4(),
        dtype: m.dtype, label: m.label || '', color: def?.color || '#888780',
        coverage: def?.coverage || 0, heatmap: def?.heatmap || false,
        x: m.x - 19, y: m.y - 19,
        model: '', ip: '', notes: '', cost: 0, qty: 1, status: 'existing', photoUrl: '',
        hmRangeFt: 120, hmStrength: 0.75,
        unconfirmed: true,
      }
    })
    updateDevices([...devices, ...newDevices])
    setSaveMsg(`Detected ${newDevices.length} device${newDevices.length === 1 ? '' : 's'} — review the highlighted markers below`)
    setTimeout(() => setSaveMsg(''), 5000)
  }
  function confirmDetectedDevice(devId) {
    patchDeviceById(devId, { unconfirmed: false })
    const d = devices.find(x => x.id === devId)
    if (d && NETWORK_MAPPER_DTYPES.includes(d.dtype) && portMapperSiteId && !d.portMapperRackId) {
      createPortMapperRack(portMapperSiteId, d.rackId || d.label).then(({ rack, error }) => {
        if (error) { console.warn('Port Mapper rack sync failed:', error); return }
        if (rack?.id) patchDeviceById(devId, { portMapperRackId: rack.id })
      })
    }
  }
  function confirmAllDetectedDevices() {
    unconfirmedDevices.forEach(d => confirmDetectedDevice(d.id))
  }
  function discardDetectedDevice(devId) {
    updateDevices(devices.filter(d => d.id !== devId))
    if (selectedId === devId) setSelectedId(null)
  }
  function discardAllDetectedDevices() {
    updateDevices(devices.filter(d => !d.unconfirmed))
  }
  function retypeDetectedDevice(devId, newDtype) {
    const def = getDeviceDef(newDtype)
    patchDeviceById(devId, { dtype: newDtype, color: def?.color || '#888780', coverage: def?.coverage || 0, heatmap: def?.heatmap || false })
  }
  function relabelDetectedDevice(devId, newLabel) {
    patchDeviceById(devId, { label: newLabel })
  }

  function duplicateSelectedDevice() {
    if (!selectedDevice) return
    const copy = { ...selectedDevice, id: uuidv4(), x: selectedDevice.x + 24, y: selectedDevice.y + 24 }
    updateDevices([...devices, copy])
    setSelectedId(copy.id)
  }
  async function handleDevicePhotoUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selectedDevice) return
    setSaving(true)
    const { url, error } = await uploadDevicePhoto(id, selectedDevice.id, file)
    setSaving(false)
    if (error) { setError('Photo upload failed: ' + error.message); return }
    updateSelectedDevice('photoUrl', url)
  }
  function handleDeviceMove(devId, x, y, newLabel) {
    let renameTarget = null
    setDevices(prev => {
      const n = prev.map(d => {
        if (d.id !== devId) return d
        const updated = { ...d, x, y }
        if (newLabel !== undefined) {
          updated.label = newLabel
          // If this MDF/IDF/switch already has a rack in Port Mapper and
          // no separate Rack ID override is set, keep the rack's name in
          // sync with the device's own label too.
          if (NETWORK_MAPPER_DTYPES.includes(d.dtype) && d.portMapperRackId && !d.rackId) {
            renameTarget = { rackId: d.portMapperRackId, name: newLabel }
          }
        }
        return updated
      })
      scheduleSave(n, cables, svgMarkup, pxPerFt)
      return n
    })
    if (renameTarget) {
      updatePortMapperRackName(renameTarget.rackId, renameTarget.name).then(({ error }) => {
        if (error) console.warn('Port Mapper rack rename failed:', error)
      })
    }
  }
  function handleDeviceSelect(devId) { setSelectedId(devId); setSelectedCableId(null); setShowNetworkMapper(false) }
  function handleCableAdd(data) {
    const c = { ...data, id: uuidv4() }
    updateCables([...cables, c])
    setSelectedCableId(c.id); setSelectedId(null)
  }
  function handleCableSelect(cableId) { setSelectedCableId(cableId); setSelectedId(null) }

  const selectedDevice = devices.find(d => d.id === selectedId)
  const gatewayFillColors = [...new Set(devices.filter(d => d.dtype === 'rak-gw').map(d => d.hmFillColor || ''))]
  const allGatewaysAuto = gatewayFillColors.length <= 1 && (gatewayFillColors.length === 0 || gatewayFillColors[0] === '')
  const allGatewaysColor = gatewayFillColors.length === 1 && gatewayFillColors[0] ? gatewayFillColors[0] : null
  const gatewayRanges = [...new Set(devices.filter(d => d.dtype === 'rak-gw').map(d => d.hmRangeFt || 150))]
  const allGatewaysRange = gatewayRanges.length === 1 ? gatewayRanges[0] : null
  const [rackEquipment, setRackEquipment] = useState([])
  const [loadingRackEquipment, setLoadingRackEquipment] = useState(false)
  const [rackEquipmentError, setRackEquipmentError] = useState('')

  const selectedRackId = selectedDevice?.portMapperRackId
  useEffect(() => {
    if (!selectedRackId) { setRackEquipment([]); setRackEquipmentError(''); return }
    let cancelled = false
    setLoadingRackEquipment(true)
    getPortMapperRackDevices(selectedRackId).then(({ devices: eq, error }) => {
      if (cancelled) return
      setLoadingRackEquipment(false)
      if (error) { setRackEquipmentError(error); setRackEquipment([]); return }
      setRackEquipmentError('')
      setRackEquipment(eq)
    })
    return () => { cancelled = true }
  }, [selectedRackId])
  const selectedCable = cables.find(c => c.id === selectedCableId)

  function updateSelectedDevice(field, value) {
    setDevices(prev => {
      const n = prev.map(d => d.id === selectedId ? { ...d, [field]: value } : d)
      scheduleSave(n, cables, svgMarkup, pxPerFt)
      return n
    })
  }
  function patchDeviceById(deviceId, changes) {
    setDevices(prev => {
      const n = prev.map(d => d.id === deviceId ? { ...d, ...changes } : d)
      scheduleSave(n, cables, svgMarkup, pxPerFt)
      return n
    })
  }
  function updateSelectedCable(field, value) {
    setCables(prev => {
      const n = prev.map(c => c.id === selectedCableId ? { ...c, [field]: value } : c)
      scheduleSave(devices, n, svgMarkup, pxPerFt)
      return n
    })
  }
  function deleteSelectedDevice() {
    const n = devices.filter(d => d.id !== selectedId)
    updateDevices(n); setSelectedId(null)
  }
  function deleteSelectedCable() {
    const n = cables.filter(c => c.id !== selectedCableId)
    updateCables(n); setSelectedCableId(null)
  }

  async function handleFloorPlanUpload(e) {
    const file = e.target.files[0]; if (!file) return
    setSaving(true)
    const { url, error } = await uploadFloorPlan(id, file)
    if (error) { setError('Upload failed: ' + error.message); setSaving(false); return }

    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    let pageCount = 1
    if (isPDF) {
      try { pageCount = await getPdfPageCount(url) } catch (err) { console.warn('Could not read PDF page count:', err) }
    }

    if (pageCount > 1 && window.confirm(
      `This PDF has ${pageCount} pages. Create ${pageCount - 1} additional survey(s) in this project — one per remaining page — so each floor is its own survey?`
    )) {
      setFloorPlanUrl(url); setFloorPlanPage(1)
      await saveSurvey(id, { floor_plan_url: url, floor_plan_page: 1 })
      let created = 0
      for (let p = 2; p <= pageCount; p++) {
        const { data: newSurvey, error: createErr } = await createSurvey(survey.user_id, `Floor ${p}`, survey.project_id || null)
        if (createErr || !newSurvey) { console.warn(`Couldn't create survey for page ${p}:`, createErr); continue }
        const { error: saveErr } = await saveSurvey(newSurvey.id, { floor_plan_url: url, floor_plan_page: p })
        if (!saveErr) created++
      }
      setSaving(false)
      setSaveMsg(created === pageCount - 1
        ? `Created ${created} additional floor survey(s)`
        : `Created ${created} of ${pageCount - 1} additional floor survey(s) — check for errors`)
      setTimeout(() => setSaveMsg(''), 4000)
      e.target.value = ''
      return
    }

    setFloorPlanUrl(url); setFloorPlanPage(1)
    await saveSurvey(id, { floor_plan_url: url, floor_plan_page: 1 })
    setSaving(false); setSaveMsg('Floor plan uploaded'); setTimeout(() => setSaveMsg(''), 2500)
    e.target.value = ''

    // Offer to scan it right away for markers already drawn on the
    // plan — these come in as flattened pixels with no metadata, so
    // detection is the only way to recover them as editable devices
    // instead of re-placing everything by hand. Uses the free,
    // instant color-matching detector — no API key required.
    if (isPDF && window.confirm('Scan this PDF for existing device markers (matches by marker color — instant, no AI key needed) and add them as editable devices you can review?')) {
      handleDetectDevicesByColor(url, 1)
    }
  }

  async function handleDeleteFloorPlan() {
    if (!window.confirm('Remove the floor plan from this survey?')) return
    setSaving(true)
    await saveSurvey(id, { floor_plan_url: '', floor_plan_rotation: 0, floor_plan_page: 1 })
    setFloorPlanUrl('')
    setFloorPlanRotation(0)
    setFloorPlanPage(1)
    setSaving(false); setSaveMsg('Floor plan removed'); setTimeout(() => setSaveMsg(''), 2000)
  }

  async function handleRotateFloorPlan() {
    const newRotation = (floorPlanRotation + 90) % 360
    setFloorPlanRotation(newRotation)
    await saveSurvey(id, { floor_plan_rotation: newRotation })
  }

  // Toggles whether labels are shown for one specific device type
  // (e.g. "Reolink Fisheye") without affecting other types in the same
  // category (Dome/Bullet cameras keep their labels). Saved
  // immediately, same one-off pattern as rotate — this is a rare,
  // deliberate action, not part of the debounced main-canvas autosave.
  async function toggleLabelVisibility(dtype) {
    const next = hiddenLabelTypes.includes(dtype)
      ? hiddenLabelTypes.filter(t => t !== dtype)
      : [...hiddenLabelTypes, dtype]
    setHiddenLabelTypes(next)
    await saveSurvey(id, { hidden_label_types: next }, { updatedBy: user?.id })
  }

  async function handleRenameSurvey() {
    if (!nameInput.trim() || nameInput.trim() === survey?.name) { setEditingName(false); return }
    await saveSurvey(id, { name: nameInput.trim() })
    setSurvey(s => ({ ...s, name: nameInput.trim() }))
    setEditingName(false)
    setSaveMsg('Renamed'); setTimeout(() => setSaveMsg(''), 2000)
  }

  function startCalibrate() {
    setMeasuring(false)
    setCalibrating(true)
    setMode('select')
  }

  function startMeasure() {
    setCalibrating(false)
    setMeasuring(true)
    setMode('select')
  }

  async function openCopyScale() {
    setShowCopyScale(true)
    setCopyScaleMsg(''); setSelectedSiblings({})
    if (!survey?.project_id) { setSiblingSurveys([]); return }
    setLoadingSiblings(true)
    const { data } = await getSurveys()
    setSiblingSurveys((data || []).filter(s => s.project_id === survey.project_id && s.id !== id))
    setLoadingSiblings(false)
  }

  function toggleSibling(sid) {
    setSelectedSiblings(s => ({ ...s, [sid]: !s[sid] }))
  }

  async function handleCopyScale() {
    const targets = siblingSurveys.filter(s => selectedSiblings[s.id])
    if (targets.length === 0) return
    setCopyingScale(true)
    let succeeded = 0
    for (const s of targets) {
      const { error } = await saveSurvey(s.id, { px_per_ft: pxPerFt })
      if (!error) succeeded++
    }
    setCopyingScale(false)
    setCopyScaleMsg(succeeded === targets.length
      ? `Copied ${pxPerFt} px/ft to ${succeeded} floor${succeeded !== 1 ? 's' : ''}.`
      : `Copied to ${succeeded} of ${targets.length} — check for errors.`)
    setSelectedSiblings({})
  }

  function handleCalibrateDrag(x1, y1, x2, y2) {
    const dx = x2 - x1
    const dy = y2 - y1
    const pixelDist = Math.round(Math.sqrt(dx * dx + dy * dy))
    if (pixelDist < 3) { setCalibrating(false); return } // too small to be intentional
    setCalibratePixels(pixelDist)
    setShowCalibrateModal(true)
    setCalibrating(false)
  }

  function applyCalibration() {
    const ft = parseFloat(calibrateDistance)
    if (!ft || ft <= 0 || calibratePixels <= 0) return
    const newScale = parseFloat((calibratePixels / ft).toFixed(2))
    updateScale(newScale)
    setScaleInput(String(newScale))
    setShowCalibrateModal(false)
    setCalibrateDistance('')
    setSaveMsg('Scale set: ' + newScale + ' px/ft'); setTimeout(() => setSaveMsg(''), 3000)
  }

  async function handleExportPDF() {
    setExportingPDF(true)
    try {
      const canvasEl = document.querySelector('[data-export-canvas]')
      if (!canvasEl) { alert('Could not find canvas to export.'); setExportingPDF(false); return }
      const canvasBounds = canvasRef.current?.getFloorPlanBounds?.()
      const blob = await buildSurveyPdfBlob({ canvasEl, canvasBounds, survey, devices })
      downloadBlob(blob, `${safeFileName(survey?.name || 'survey')}.pdf`)
    } catch (err) { alert('Export failed: ' + err.message) }
    setExportingPDF(false)
  }

  async function handleShare() {
    const { token: t, error } = await createShareToken(id)
    if (error) { setError('Could not generate share link.'); return }
    const url = `${window.location.origin}/shared/${t}`
    setShareUrl(url); setShowShare(true)
  }

  function getBOM() {
    const grouped = {}
    devices.forEach(d => {
      const k = d.dtype + (d.model || '')
      if (!grouped[k]) grouped[k] = { label: d.label, model: d.model || '—', cost: d.cost || 0, qty: 0 }
      grouped[k].qty += d.qty || 1
    })
    return Object.values(grouped)
  }

  const toolbarModes = isShared
    ? [{ id: 'select', icon: 'cursor-text', label: 'Select' }]
    : [
        { id: 'select',  icon: 'cursor-text', label: 'Select'  },
        { id: 'cable',   icon: 'timeline',    label: 'Cable'   },
        { id: 'wall',    icon: 'pencil',      label: 'Wall'    },
        { id: 'room',    icon: 'square',      label: 'Room'    },
        { id: 'label',   icon: 'text-size',   label: 'Label'   },
        { id: 'redline', icon: 'scribble',    label: 'Redline' },
      ]

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: 14, color: '#888' }}>Loading survey…</div>
  if (error) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: 14, color: '#A32D2D' }}>{error}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff', fontFamily: 'system-ui, sans-serif' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f8f8f6', borderBottom: '0.5px solid #e0dfd8', flexShrink: 0, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/dashboard')} style={ghostBtn}>
          <i className="ti ti-arrow-left" /> Dashboard
        </button>
        {editingName ? (
          <input
            autoFocus
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onBlur={handleRenameSurvey}
            onKeyDown={e => { if (e.key === 'Enter') handleRenameSurvey(); if (e.key === 'Escape') setEditingName(false) }}
            style={{ fontSize: 13, fontWeight: 500, color: '#1a1a18', background: '#fff', border: '0.5px solid #378ADD', borderRadius: 6, padding: '3px 8px', outline: 'none', width: 220 }}
          />
        ) : (
          <span
            onClick={() => { setNameInput(survey?.name || ''); setEditingName(true) }}
            title="Click to rename"
            style={{ fontSize: 13, fontWeight: 500, color: '#1a1a18', marginLeft: 4, cursor: 'text', padding: '3px 6px', borderRadius: 6, border: '0.5px solid transparent' }}
            onMouseEnter={e => e.target.style.borderColor = '#e0dfd8'}
            onMouseLeave={e => e.target.style.borderColor = 'transparent'}
          >
            {survey?.name} <i className="ti ti-pencil" style={{ fontSize: 10, color: '#aaa', verticalAlign: '0px' }} />
          </span>
        )}
        {isShared && <span style={{ background: '#666', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 500 }}>View only</span>}
        <div style={{ width: '0.5px', height: 22, background: '#e0dfd8', margin: '0 2px' }} />

        {!isShared && (
          <>
            <button style={tbBtn} onClick={() => fileInputRef.current.click()}>
              <i className="ti ti-upload" /> {floorPlanUrl ? 'Replace Plan' : 'Floor Plan'}
            </button>
            {floorPlanUrl && (
              <>
                <button style={{ ...tbBtn, color: '#534AB7', borderColor: '#AFA9EC' }} onClick={handleRotateFloorPlan} title="Rotate 90° clockwise">
                  <i className="ti ti-rotate-clockwise" /> Rotate {floorPlanRotation > 0 ? `(${floorPlanRotation}°)` : ''}
                </button>
                <button style={{ ...tbBtn, color: '#A32D2D', borderColor: '#F09595' }} onClick={handleDeleteFloorPlan}>
                  <i className="ti ti-x" /> Remove Plan
                </button>
                <button style={{ ...tbBtn, color: '#1D9E75', borderColor: '#9AD9BE' }} onClick={() => navigate(`/survey/${id}/georeference`)} title="Overlay this floor plan on satellite imagery">
                  <i className="ti ti-map-pin" /> Georeference
                </button>
                {floorPlanUrl && (
                  <button style={{ ...tbBtn, color: '#BA7517', borderColor: '#F0D488' }} onClick={() => handleDetectDevicesByColor()} disabled={detecting}
                    title="Free, instant — finds markers on the floor plan by matching their color (no AI, no API key needed)">
                    <i className={`ti ti-${detecting ? 'loader-2' : 'scan'}`} /> {detecting ? 'Detecting…' : 'Detect Devices'}
                  </button>
                )}
                {isPdfFloorPlan && (
                  <button style={{ ...tbBtn, color: '#534AB7', borderColor: '#AFA9EC', fontSize: 11 }} onClick={() => handleDetectDevices()} disabled={detecting}
                    title="Optional — uses AI to also read each marker's label/type (e.g. distinguishing GW vs IDF text); requires an ANTHROPIC_API_KEY set on the server">
                    <i className="ti ti-sparkles" /> AI Label Detect
                  </button>
                )}
              </>
            )}
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={handleFloorPlanUpload} />
            <div style={{ width: '0.5px', height: 22, background: '#e0dfd8' }} />
          </>
        )}

        {toolbarModes.map(m => (
          <button key={m.id} style={{ ...tbBtn, ...(mode === m.id ? activeTbBtn : {}) }} onClick={() => setMode(m.id)}>
            <i className={`ti ti-${m.icon}`} /> {m.label}
          </button>
        ))}

        {mode === 'cable' && (
          <select value={activeCableType} onChange={e => setActiveCableType(e.target.value)}
            style={{ fontSize: 12, padding: '4px 6px', border: '0.5px solid #ccc', borderRadius: 6, background: '#fff' }}>
            <option value="cat6">Cat6</option>
            <option value="fiber">Fiber</option>
            <option value="coax">Coax</option>
            <option value="power">Power</option>
          </select>
        )}

        <div style={{ width: '0.5px', height: 22, background: '#e0dfd8' }} />
        <button style={{ ...tbBtn, ...(showHeatmap ? { ...activeTbBtn, color: '#1D9E75', borderColor: '#1D9E75', background: '#E1F5EE' } : {}) }}
          onClick={() => setShowHeatmap(h => !h)}>
          <i className="ti ti-wave-sine" /> Heat Map
        </button>
        {showHeatmap && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 10, color: '#888' }}>Opacity</span>
            <input type="range" min="0.1" max="1" step="0.05" value={heatmapOpacity}
              onChange={e => setHeatmapOpacity(parseFloat(e.target.value))}
              style={{ width: 60 }} title="Heat map opacity" />
            <span style={{ fontSize: 10, color: '#888', minWidth: 26 }}>{Math.round(heatmapOpacity * 100)}%</span>
          </div>
        )}
        {showHeatmap && !isShared && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: '#888' }}>AOC Color</span>
            <button onClick={() => applyGlobalAOCColor('')}
              title="Auto — green (strong) to red (weak)"
              style={{
                padding: '3px 8px', fontSize: 10, fontWeight: 500, borderRadius: 6, cursor: 'pointer',
                background: allGatewaysAuto ? '#378ADD' : '#fff',
                color: allGatewaysAuto ? '#fff' : '#666',
                border: allGatewaysAuto ? 'none' : '0.5px solid #ccc',
              }}>
              Auto
            </button>
            {COLOR_PALETTE.map(c => (
              <button key={c} onClick={() => applyGlobalAOCColor(c)} title={c}
                style={{
                  width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                  border: allGatewaysColor?.toLowerCase() === c.toLowerCase() ? '2px solid #1a1a18' : '1px solid rgba(0,0,0,0.15)',
                }} />
            ))}
          </div>
        )}
        {showHeatmap && !isShared && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 10, color: '#888' }}>AOC Range</span>
            <input type="number" min="1" step="5"
              key={allGatewaysRange ?? 'mixed'}
              defaultValue={allGatewaysRange ?? ''}
              placeholder={allGatewaysRange === null ? 'Mixed' : ''}
              onBlur={e => {
                const v = parseInt(e.target.value)
                if (v > 0) applyGlobalAOCRange(v)
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              style={{ width: 55, fontSize: 11, padding: '3px 5px', border: '0.5px solid #ccc', borderRadius: 5 }}
              title="Set LoRa range (ft) for every gateway at once" />
            <span style={{ fontSize: 10, color: '#888' }}>ft (all)</span>
          </div>
        )}
        {!isShared && (
          <button style={{ ...tbBtn, ...(calibrating ? { color: '#E24B4A', borderColor: '#E24B4A', background: '#FCEBEB' } : {}) }}
            onClick={() => calibrating ? setCalibrating(false) : startCalibrate()}
            title="Click two points on the floor plan to set the scale">
            <i className="ti ti-ruler-measure" /> {calibrating ? 'Drag a line…' : 'Set Scale'}
          </button>
        )}
        <button style={{ ...tbBtn, ...(measuring ? { color: '#378ADD', borderColor: '#378ADD', background: '#E9F2FC' } : {}) }}
          onClick={() => measuring ? setMeasuring(false) : startMeasure()}
          title="Drag a line to measure a distance in feet">
          <i className="ti ti-ruler-3" /> {measuring ? 'Drag to measure…' : 'Measure'}
        </button>
        {!isShared && (
          <button style={tbBtn} onClick={() => setShowScale(true)} title="Manually enter px/ft">
            <i className="ti ti-adjustments" /> {pxPerFt} px/ft
          </button>
        )}
        {!isShared && survey?.project_id && (
          <button style={tbBtn} onClick={openCopyScale} title="Apply this floor's scale to other floors in the project">
            <i className="ti ti-copy" /> Copy Scale
          </button>
        )}
        {!isShared && <button style={tbBtn} onClick={() => setShowBOM(true)}><i className="ti ti-clipboard-list" /> BOM</button>}
        {!isShared && (
          <button style={{ ...tbBtn, color: '#185FA5', borderColor: '#185FA5' }} onClick={handleShare}>
            <i className="ti ti-share" /> Share
          </button>
        )}
        {!isShared && (
          <button style={{ ...tbBtn, color: exportingPDF ? '#888' : '#BA7517', borderColor: '#FAC775' }} onClick={handleExportPDF} disabled={exportingPDF}>
            <i className="ti ti-file-type-pdf" /> {exportingPDF ? 'Exporting…' : 'Export PDF'}
          </button>
        )}
        <div style={{ width: '0.5px', height: 22, background: '#e0dfd8' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9.5, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.04em' }}>Icon size</span>
          {[
            { key: 'cameras', label: 'Cam' },
            { key: 'lora',    label: 'LoRa' },
            { key: 'network', label: 'Net' },
            { key: 'access',  label: 'Access' },
          ].map(({ key, label }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: '#888', minWidth: 32 }}>{label}</span>
              <input type="number" min="4" max="80" step="1"
                value={iconSizes[key] || 16}
                onChange={e => { const v = parseInt(e.target.value) || 4; setIconSizes(s => ({...s, [key]: v})) }}
                onBlur={e => updateIconSize(key, parseInt(e.target.value) || 4)}
                style={{ width: 44, fontSize: 11, padding: '3px 5px', border: '0.5px solid #ccc', borderRadius: 5 }}
                title={label + ' icon size (px)'} />
            </div>
          ))}
        </div>

        <div style={{ width: '0.5px', height: 22, background: '#e0dfd8' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9.5, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.04em' }}>Label size</span>
          {[
            { key: 'cameras', label: 'Cam' },
            { key: 'lora',    label: 'LoRa' },
            { key: 'network', label: 'Net' },
            { key: 'access',  label: 'Access' },
          ].map(({ key, label }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: '#888', minWidth: 32 }}>{label}</span>
              <input type="number" min="6" max="60" step="1"
                value={labelSizes[key] || 10}
                onChange={e => { const v = parseInt(e.target.value) || 6; setLabelSizes(s => ({...s, [key]: v})) }}
                onBlur={e => updateLabelSize(key, parseInt(e.target.value) || 6)}
                style={{ width: 44, fontSize: 11, padding: '3px 5px', border: '0.5px solid #ccc', borderRadius: 5 }}
                title={label + ' label font size (px)'} />
            </div>
          ))}
        </div>

        {!isShared && (
          <button style={tbBtn} onClick={handleSaveNow} disabled={saving} title="Save immediately, without waiting for auto-save">
            <i className="ti ti-device-floppy" /> Save
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: saving ? '#BA7517' : (saveError ? '#A32D2D' : '#1D9E75') }}>
          {saving ? 'Saving…' : (saveError ? 'Not saved' : saveMsg)}
        </span>
      </div>

      {saveError && !conflict && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 14px', background: '#FDECEC', borderBottom: '0.5px solid #F0AFAF',
          fontSize: 12.5, color: '#7A1F1F', flexShrink: 0,
        }}>
          <i className="ti ti-alert-circle" style={{ color: '#A32D2D', fontSize: 15 }} />
          <span style={{ flex: '1 1 320px' }}>
            <strong>Your last save didn't go through:</strong> {saveError} Your edits are still here in the editor —
            they just haven't reached the server yet.
          </span>
          <button onClick={handleSaveNow} style={{ ...tbBtn, color: '#A32D2D', borderColor: '#F09595' }}>
            <i className="ti ti-refresh" /> Retry save
          </button>
        </div>
      )}

      {detectError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 14px', background: '#FDECEC', borderBottom: '0.5px solid #F0AFAF',
          fontSize: 12.5, color: '#7A1F1F', flexShrink: 0,
        }}>
          <i className="ti ti-alert-circle" style={{ color: '#A32D2D', fontSize: 15 }} />
          <span style={{ flex: '1 1 320px' }}><strong>Device detection failed:</strong> {detectError}</span>
          <button onClick={() => setDetectError('')} style={{ ...tbBtn, color: '#A32D2D', borderColor: '#F09595' }}>
            <i className="ti ti-x" /> Dismiss
          </button>
        </div>
      )}

      {conflict && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 14px', background: '#FFF7E6', borderBottom: '0.5px solid #F0D488',
          fontSize: 12.5, color: '#5A4200', flexShrink: 0,
        }}>
          <i className="ti ti-alert-triangle" style={{ color: '#BA7517', fontSize: 15 }} />
          <span style={{ flex: '1 1 320px' }}>
            <strong>{conflictEditorName ? `${conflictEditorName} saved changes` : 'Someone else saved changes'}</strong> to
            this survey while you had it open. Your unsaved edits are safe for now — choose how to proceed:
          </span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={resolveConflictReload} style={{ ...tbBtn, color: '#5A4200', borderColor: '#F0D488' }}>
              <i className="ti ti-refresh" /> Load their version
            </button>
            <button onClick={resolveConflictSaveCopy} style={{ ...tbBtn, color: '#378ADD', borderColor: '#A9CDEF' }}>
              <i className="ti ti-copy" /> Keep mine as a copy
            </button>
            <button onClick={resolveConflictOverwrite} style={{ ...tbBtn, color: '#A32D2D', borderColor: '#F09595' }}>
              <i className="ti ti-device-floppy" /> Overwrite theirs
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {!isShared && (
          <div style={{ width: 148, flexShrink: 0, background: '#f8f8f6', borderRight: '0.5px solid #e0dfd8', overflowY: 'auto', padding: 8 }}>
            {DEVICE_DEFS.map(section => (
              <div key={section.section} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 500, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>
                  {section.section}
                </div>
                {section.items.map(item => (
                  <div key={item.dtype} draggable
                    onDragStart={e => e.dataTransfer.setData('app/device', JSON.stringify(item))}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 6, cursor: 'grab', fontSize: 12, color: '#1a1a18', border: '0.5px solid transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fff'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ width: 30, height: 30, borderRadius: 6, background: item.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <DeviceIcon dtype={item.dtype} color={item.color} size={22} />
                    </div>
                    <span>{item.label.replace('RAK ', '').replace(' Camera', '').replace('Access Point', 'AP')}</span>
                    {item.heatmap && (
                      <span style={{ fontSize: 9, background: '#EAF3DE', color: '#3B6D11', padding: '1px 4px', borderRadius: 3, border: '0.5px solid #97C459', marginLeft: 'auto' }}>heat</span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); toggleLabelVisibility(item.dtype) }}
                      title={hiddenLabelTypes.includes(item.dtype) ? `${item.label} labels are hidden — click to show` : `Hide ${item.label} labels`}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                        marginLeft: item.heatmap ? 4 : 'auto',
                        color: hiddenLabelTypes.includes(item.dtype) ? '#BA7517' : '#bbb',
                        display: 'flex', alignItems: 'center', flexShrink: 0,
                      }}
                    >
                      <i className={`ti ti-${hiddenLabelTypes.includes(item.dtype) ? 'eye-off' : 'eye'}`} style={{ fontSize: 13 }} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 500, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Cable types</div>
              {Object.entries(CABLE_STYLES).map(([type, cs]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 4px', fontSize: 11, color: '#666' }}>
                  <svg width="30" height="6"><line x1="0" y1="3" x2="30" y2="3" stroke={cs.stroke} strokeWidth={cs.width} strokeDasharray={cs.dash || undefined} /></svg>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 500, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Heat map key</div>
              <div style={{ height: 8, borderRadius: 4, background: 'linear-gradient(to right,rgba(255,50,0,1),rgba(255,200,0,0.8),rgba(0,180,100,0.3))', marginBottom: 3 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888' }}><span>Weak</span><span>Strong</span></div>
            </div>
          </div>
        )}

        <SurveyCanvas
          ref={canvasRef}
          devices={devices} cables={cables} svgMarkup={svgMarkup}
          pxPerFt={pxPerFt} showHeatmap={showHeatmap} heatmapOpacity={heatmapOpacity}
          mode={mode} activeCableType={activeCableType}
          onDeviceAdd={handleDeviceAdd} onDeviceMove={handleDeviceMove} onDeviceSelect={handleDeviceSelect}
          onCableAdd={handleCableAdd} onCableSelect={handleCableSelect}
          onMarkupChange={updateMarkup}
          selectedId={selectedId} selectedCableId={selectedCableId}
          floorPlanUrl={floorPlanUrl}
          floorPlanPage={floorPlanPage}
          floorPlanRotation={floorPlanRotation}
          iconSizes={iconSizes}
          labelSizes={labelSizes}
          hiddenLabelTypes={hiddenLabelTypes}
          calibrating={calibrating}
          measuring={measuring}
          onCalibrateDrag={handleCalibrateDrag}
          readOnly={isShared}
        />

        <div style={{ width: 172, flexShrink: 0, background: '#f8f8f6', borderLeft: '0.5px solid #e0dfd8', padding: 12, overflowY: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: '#1a1a18' }}>Properties</div>

          {!selectedDevice && !selectedCable && (
            <p style={{ fontSize: 12, color: '#888' }}>Select a device or cable.</p>
          )}

          {selectedDevice && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div>
                <label style={propLabel}>Status</label>
                <select style={propInput} value={selectedDevice.status || 'existing'}
                  disabled={isShared}
                  onChange={e => updateSelectedDevice('status', e.target.value)}>
                  {Object.entries(DEVICE_STATUSES).map(([key, s]) => (
                    <option key={key} value={key}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={propLabel}>Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <input type="color" value={selectedDevice.color || '#378ADD'}
                    disabled={isShared}
                    onChange={e => updateSelectedDevice('color', e.target.value)}
                    style={{ width: 34, height: 30, padding: 2, border: '0.5px solid #ccc', borderRadius: 6, cursor: isShared ? 'default' : 'pointer', background: '#fff' }} />
                  <input style={{ ...propInput, flex: 1 }} type="text" value={selectedDevice.color || ''}
                    disabled={isShared}
                    onChange={e => updateSelectedDevice('color', e.target.value)} placeholder="#378ADD" />
                </div>
                {!isShared && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
                    {COLOR_PALETTE.map(c => (
                      <button key={c} onClick={() => updateSelectedDevice('color', c)}
                        title={c}
                        style={{
                          width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                          border: selectedDevice.color?.toLowerCase() === c.toLowerCase() ? '2px solid #1a1a18' : '1px solid rgba(0,0,0,0.15)',
                        }} />
                    ))}
                  </div>
                )}
                {!isShared && getDefaultDeviceColor(selectedDevice.dtype) && selectedDevice.color !== getDefaultDeviceColor(selectedDevice.dtype) && (
                  <button onClick={() => updateSelectedDevice('color', getDefaultDeviceColor(selectedDevice.dtype))}
                    style={{ background: 'none', border: 'none', color: '#378ADD', cursor: 'pointer', fontSize: 11, padding: '4px 0 0' }}>
                    Reset to default
                  </button>
                )}
              </div>
              {NETWORK_MAPPER_DTYPES.includes(selectedDevice.dtype) && (
                <div style={{ background: '#F4F3FC', border: '0.5px solid #D8D4F5', borderRadius: 8, padding: 10 }}>
                  <label style={propLabel}>Rack / site ID (optional)</label>
                  <input style={propInput} type="text" placeholder="e.g. RACK-04"
                    value={selectedDevice.rackId || ''}
                    disabled={isShared}
                    onChange={e => updateSelectedDevice('rackId', e.target.value)}
                    onBlur={e => {
                      const name = e.target.value.trim()
                      if (name && selectedDevice.portMapperRackId) {
                        updatePortMapperRackName(selectedDevice.portMapperRackId, name).then(({ error }) => {
                          if (error) console.warn('Port Mapper rack rename failed:', error)
                        })
                      }
                    }} />
                  <button onClick={() => setShowNetworkMapper(true)}
                    style={{ ...ghostBtnSmall, width: '100%', marginTop: 8, background: '#534AB7', color: '#fff', border: 'none' }}>
                    <i className="ti ti-topology-star-3" style={{ marginRight: 4 }} /> Open in Network Mapper
                  </button>
                  {selectedDevice.portMapperRackId && (
                    <div style={{ marginTop: 10, borderTop: '0.5px solid #D8D4F5', paddingTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: '#534AB7' }}>Equipment in rack</span>
                        <button
                          onClick={() => {
                            setLoadingRackEquipment(true)
                            getPortMapperRackDevices(selectedDevice.portMapperRackId).then(({ devices: eq, error }) => {
                              setLoadingRackEquipment(false)
                              if (error) { setRackEquipmentError(error); return }
                              setRackEquipmentError(''); setRackEquipment(eq)
                            })
                          }}
                          style={{ background: 'none', border: 'none', color: '#534AB7', cursor: 'pointer', fontSize: 10.5 }}>
                          <i className="ti ti-refresh" /> Refresh
                        </button>
                      </div>
                      {loadingRackEquipment ? (
                        <p style={{ fontSize: 11, color: '#888', margin: 0 }}>Loading…</p>
                      ) : rackEquipmentError ? (
                        <p style={{ fontSize: 11, color: '#A32D2D', margin: 0 }}>Couldn't load: {rackEquipmentError}</p>
                      ) : rackEquipment.length === 0 ? (
                        <p style={{ fontSize: 11, color: '#aaa', margin: 0 }}>No equipment added in Network Mapper yet.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {rackEquipment.map(eq => (
                            <div key={eq.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: '0.5px solid #E5E1F7', borderRadius: 5, padding: '4px 7px' }}>
                              <span style={{ fontSize: 11.5, color: '#1a1a18' }}>{eq.label}</span>
                              {eq.ports ? <span style={{ fontSize: 10, color: '#888' }}>{eq.ports}p</span> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {[
                { label: 'Label',        field: 'label', type: 'text' },
                { label: 'Model / Part #', field: 'model', type: 'text', placeholder: 'e.g. RAK7268C' },
                { label: 'IP / MAC',     field: 'ip',    type: 'text', placeholder: '192.168.1.x' },
                { label: 'Unit cost ($)', field: 'cost',  type: 'number' },
                { label: 'Qty',          field: 'qty',   type: 'number' },
              ].map(f => (
                <div key={f.field}>
                  <label style={propLabel}>{f.label}</label>
                  <input style={propInput} type={f.type} placeholder={f.placeholder || ''}
                    min={f.type === 'number' ? 0 : undefined}
                    value={selectedDevice[f.field] ?? ''}
                    disabled={isShared}
                    onChange={e => updateSelectedDevice(f.field, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                    onBlur={f.field === 'label' ? e => {
                      const name = e.target.value.trim()
                      // Keep the rack's name in Port Mapper in sync with
                      // the device's label, unless a separate Rack ID
                      // override is set (that one wins instead).
                      if (name && NETWORK_MAPPER_DTYPES.includes(selectedDevice.dtype) && selectedDevice.portMapperRackId && !selectedDevice.rackId) {
                        updatePortMapperRackName(selectedDevice.portMapperRackId, name).then(({ error }) => {
                          if (error) console.warn('Port Mapper rack rename failed:', error)
                        })
                      }
                    } : undefined} />
                </div>
              ))}
              <div>
                <label style={propLabel}>Notes</label>
                <textarea style={{ ...propInput, minHeight: 48, resize: 'vertical' }} placeholder="Mount height, port…"
                  disabled={isShared}
                  value={selectedDevice.notes || ''} onChange={e => updateSelectedDevice('notes', e.target.value)} />
              </div>
              {!isShared && (
              <div>
                <label style={propLabel}>Photo</label>
                {selectedDevice.photoUrl ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <img src={selectedDevice.photoUrl} alt="Device" style={{ width: '100%', borderRadius: 6, border: '0.5px solid #e0dfd8', display: 'block' }} />
                    <button onClick={() => devicePhotoInputRef.current.click()} style={ghostBtnSmall}>Replace photo</button>
                    <button onClick={() => updateSelectedDevice('photoUrl', '')} style={{ ...ghostBtnSmall, color: '#A32D2D', borderColor: '#F09595' }}>Remove photo</button>
                  </div>
                ) : (
                  <button onClick={() => devicePhotoInputRef.current.click()} style={ghostBtnSmall}>
                    <i className="ti ti-camera-plus" style={{ marginRight: 4 }} /> Attach photo
                  </button>
                )}
                <input ref={devicePhotoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleDevicePhotoUpload} />
              </div>
              )}
              {isShared && selectedDevice.photoUrl && (
                <div>
                  <label style={propLabel}>Photo</label>
                  <img src={selectedDevice.photoUrl} alt="Device" style={{ width: '100%', borderRadius: 6, border: '0.5px solid #e0dfd8', display: 'block' }} />
                </div>
              )}
              {selectedDevice.dtype === 'rak-gw' && (
                <>
                  <div>
                    <label style={propLabel}>LoRa range</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <input type="range" min="25" max="400" step="5" style={{ flex: 1 }}
                        value={selectedDevice.hmRangeFt || 150}
                        disabled={isShared}
                        onChange={e => updateSelectedDevice('hmRangeFt', parseInt(e.target.value))} />
                      <input type="number" min="1" step="1" style={{ ...propInput, width: 60, flexShrink: 0, textAlign: 'right' }}
                        value={selectedDevice.hmRangeFt || 150}
                        disabled={isShared}
                        onChange={e => {
                          const v = parseInt(e.target.value)
                          updateSelectedDevice('hmRangeFt', Number.isFinite(v) ? Math.max(1, v) : 0)
                        }} />
                      <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>ft</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888' }}>
                      <span>25 ft</span><span>400 ft</span>
                    </div>
                  </div>
                  <div>
                    <label style={propLabel}>Signal strength</label>
                    <select style={propInput} value={selectedDevice.hmStrength || 1}
                      disabled={isShared}
                      onChange={e => updateSelectedDevice('hmStrength', parseFloat(e.target.value))}>
                      <option value="1">Strong — open floor / warehouse</option>
                      <option value="0.75">Medium — office / drywall</option>
                      <option value="0.5">Weak — concrete / CMU / hospital</option>
                    </select>
                  </div>
                  <div>
                    <label style={propLabel}>Coverage color</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <button onClick={() => updateSelectedDevice('hmFillColor', '')}
                        disabled={isShared}
                        style={{
                          ...ghostBtnSmall, fontSize: 10.5,
                          background: !selectedDevice.hmFillColor ? '#378ADD' : '#fff',
                          color: !selectedDevice.hmFillColor ? '#fff' : '#666',
                          border: !selectedDevice.hmFillColor ? 'none' : '0.5px solid #ccc',
                        }}>
                        Auto (green–red)
                      </button>
                      {selectedDevice.hmFillColor && (
                        <input type="color" value={selectedDevice.hmFillColor}
                          disabled={isShared}
                          onChange={e => updateSelectedDevice('hmFillColor', e.target.value)}
                          style={{ width: 30, height: 26, padding: 2, border: '0.5px solid #ccc', borderRadius: 6, cursor: isShared ? 'default' : 'pointer', background: '#fff' }} />
                      )}
                    </div>
                    {!isShared && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {COLOR_PALETTE.map(c => (
                          <button key={c} onClick={() => updateSelectedDevice('hmFillColor', c)}
                            title={c}
                            style={{
                              width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                              border: selectedDevice.hmFillColor?.toLowerCase() === c.toLowerCase() ? '2px solid #1a1a18' : '1px solid rgba(0,0,0,0.15)',
                            }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#888', lineHeight: 1.5, background: '#f8f8f6', padding: '6px 8px', borderRadius: 6, border: '0.5px solid #e0dfd8' }}>
                    <strong style={{ color: '#666' }}>Estimated coverage</strong><br/>
                    Falloff follows a log-distance path-loss curve (published indoor LoRaWAN research), so signal fades quickly near the edge of range rather than in even steps. The dashed circle marks your specified range — actual coverage still varies with real construction, antenna placement, and interference.<br/>
                    Use "Set Scale" to calibrate ft to your floor plan.
                  </div>
                </>
              )}
              {!isShared && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={duplicateSelectedDevice} style={{ ...ghostBtnSmall, flex: 1 }}>
                    <i className="ti ti-copy" style={{ marginRight: 4 }} /> Duplicate
                  </button>
                  <button onClick={deleteSelectedDevice} style={{ ...dangerBtn, flex: 1 }}>
                    <i className="ti ti-trash" /> Remove
                  </button>
                </div>
              )}
            </div>
          )}

          {selectedCable && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div>
                <label style={propLabel}>Type</label>
                <select style={propInput} value={selectedCable.type || 'cat6'}
                  disabled={isShared}
                  onChange={e => updateSelectedCable('type', e.target.value)}>
                  {Object.keys(CABLE_STYLES).map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={propLabel}>Label</label>
                <input style={propInput} type="text" placeholder="e.g. Cam 1 → Switch"
                  disabled={isShared}
                  value={selectedCable.label || ''} onChange={e => updateSelectedCable('label', e.target.value)} />
              </div>
              {!isShared && (
                <button onClick={deleteSelectedCable} style={dangerBtn}>
                  <i className="ti ti-trash" /> Remove cable
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '4px 12px', fontSize: 11, color: '#888', background: '#f8f8f6', borderTop: '0.5px solid #e0dfd8', display: 'flex', gap: 16, flexShrink: 0, alignItems: 'center' }}>
        <span>Devices: {devices.length}</span>
        <span>Cables: {cables.length}</span>
        <span style={{ color: '#1D9E75', fontWeight: 500 }}>Scale: {pxPerFt} px/ft</span>
        <span style={{ marginLeft: 'auto' }}>Mode: {mode}</span>
        {floorPlanUrl && <span style={{ color: '#1D9E75' }}>✓ Floor plan loaded</span>}
      </div>

      {showCalibrateModal && (
        <Modal onClose={() => { setShowCalibrateModal(false) }}>
          <h3 style={modalTitle}>Set scale from measurement</h3>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 14, lineHeight: 1.5 }}>
            You drew a line <strong>{calibratePixels} pixels</strong> long on screen.<br/>
            Enter the real-world distance between those two points.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <input type="number" min="1" step="0.5" value={calibrateDistance}
              onChange={e => setCalibrateDistance(e.target.value)}
              placeholder="e.g. 20"
              autoFocus
              style={{ width: 90, padding: '7px 10px', fontSize: 14, border: '0.5px solid #ccc', borderRadius: 8, outline: 'none' }} />
            <span style={{ fontSize: 13, color: '#666' }}>feet</span>
          </div>
          {calibrateDistance && parseFloat(calibrateDistance) > 0 && (
            <p style={{ fontSize: 11, color: '#1D9E75', marginBottom: 12 }}>
              → Scale will be set to {parseFloat((calibratePixels / parseFloat(calibrateDistance)).toFixed(2))} px/ft
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...primaryBtn, background: '#EAF3DE', color: '#3B6D11', border: '0.5px solid #97C459' }}
              onClick={applyCalibration} disabled={!calibrateDistance || parseFloat(calibrateDistance) <= 0}>
              Apply scale
            </button>
            <button style={ghostBtn} onClick={() => { setShowCalibrateModal(false) }}>Cancel</button>
          </div>
        </Modal>
      )}

      {showCopyScale && (
        <Modal onClose={() => setShowCopyScale(false)}>
          <h3 style={modalTitle}>Copy scale to other floors</h3>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 14, lineHeight: 1.5 }}>
            Apply this floor's scale — <strong>{pxPerFt} px/ft</strong> — to other surveys in the same project. Useful when a multi-page floor plan uses the same drawing scale on every floor.
          </p>
          {loadingSiblings ? (
            <p style={{ fontSize: 12, color: '#888' }}>Loading…</p>
          ) : siblingSurveys.length === 0 ? (
            <p style={{ fontSize: 12, color: '#aaa' }}>No other surveys in this project yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto', marginBottom: 14 }}>
              {siblingSurveys.map(s => (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, background: '#f8f8f6', border: '0.5px solid #e0dfd8', borderRadius: 7, padding: '7px 10px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!selectedSiblings[s.id]} onChange={() => toggleSibling(s.id)} />
                  <span style={{ flex: 1, color: '#1a1a18' }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: '#aaa' }}>{s.px_per_ft || 4} px/ft</span>
                </label>
              ))}
            </div>
          )}
          {copyScaleMsg && <p style={{ fontSize: 12, color: '#0F6E56', marginBottom: 12 }}>{copyScaleMsg}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...primaryBtn, background: '#EAF3DE', color: '#3B6D11', border: '0.5px solid #97C459' }}
              onClick={handleCopyScale}
              disabled={copyingScale || Object.values(selectedSiblings).every(v => !v)}>
              {copyingScale ? 'Copying…' : 'Apply to selected'}
            </button>
            <button style={ghostBtn} onClick={() => setShowCopyScale(false)}>Close</button>
          </div>
        </Modal>
      )}

      {showScale && (
        <Modal onClose={() => setShowScale(false)}>
          <h3 style={modalTitle}>Set floor plan scale</h3>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 14, lineHeight: 1.5 }}>
            Enter how many pixels equal one foot. Tip: if a room is 30 ft wide, measure it on your floor plan in pixels and divide.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <input type="number" min="0.5" max="50" step="0.5" value={scaleInput}
              onChange={e => setScaleInput(e.target.value)}
              style={{ width: 80, ...propInput }} />
            <span style={{ fontSize: 13, color: '#666' }}>pixels per foot</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...primaryBtn, background: '#EAF3DE', color: '#3B6D11', border: '0.5px solid #97C459' }}
              onClick={() => { const v = parseFloat(scaleInput); if (v > 0) updateScale(v); setShowScale(false) }}>
              Apply
            </button>
            <button style={ghostBtn} onClick={() => setShowScale(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {showShare && (
        <Modal onClose={() => setShowShare(false)}>
          <h3 style={modalTitle}>Share this survey</h3>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 12, lineHeight: 1.5 }}>
            Anyone with this link can view the survey and add redlines. No account needed.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input readOnly value={shareUrl} style={{ flex: 1, ...propInput, background: '#f8f8f6', fontSize: 11 }} />
            <button style={primaryBtn} onClick={() => { navigator.clipboard.writeText(shareUrl).catch(() => {}) }}>Copy</button>
          </div>
          <button style={ghostBtn} onClick={() => setShowShare(false)}>Close</button>
        </Modal>
      )}

      {showBOM && (
        <Modal onClose={() => setShowBOM(false)} wide>
          <h3 style={modalTitle}>Bill of materials</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Device', 'Model', 'Qty', 'Unit $', 'Total $'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '0.5px solid #e0dfd8', color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {getBOM().length === 0
                ? <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20, color: '#888' }}>No devices placed yet.</td></tr>
                : getBOM().map((row, i) => (
                  <tr key={i}>
                    <td style={bomCell}>{row.label}</td>
                    <td style={{ ...bomCell, color: '#888', fontSize: 11 }}>{row.model}</td>
                    <td style={bomCell}>{row.qty}</td>
                    <td style={bomCell}>${(row.cost || 0).toFixed(2)}</td>
                    <td style={{ ...bomCell, fontWeight: 500 }}>${((row.cost || 0) * row.qty).toFixed(2)}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          <div style={{ textAlign: 'right', fontWeight: 500, fontSize: 13, marginTop: 10 }}>
            Grand total: ${getBOM().reduce((s, r) => s + (r.cost || 0) * r.qty, 0).toFixed(2)}
          </div>
          <button style={{ ...ghostBtn, marginTop: 12, width: '100%' }} onClick={() => setShowBOM(false)}>Close</button>
        </Modal>
      )}

      {showNetworkMapper && selectedDevice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNetworkMapper(false) }}>
          <div style={{ background: '#fff', borderRadius: 12, width: '90vw', height: '85vh', maxWidth: 1200, display: 'flex', flexDirection: 'column', border: '0.5px solid #e0dfd8', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '0.5px solid #e0dfd8', background: '#f8f8f6' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ti ti-topology-star-3" style={{ color: '#534AB7' }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a18' }}>
                  Network Mapper — {selectedDevice.label}{selectedDevice.rackId ? ` (${selectedDevice.rackId})` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={networkMapperUrl(selectedDevice)} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtnSmall, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                  <i className="ti ti-external-link" style={{ marginRight: 4 }} /> Open in new tab
                </a>
                <button onClick={() => setShowNetworkMapper(false)} style={ghostBtnSmall}>
                  <i className="ti ti-x" />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <iframe
                src={networkMapperUrl(selectedDevice)}
                title="Network Mapper"
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            </div>
            <div style={{ padding: '6px 16px', fontSize: 10.5, color: '#aaa', borderTop: '0.5px solid #f0efea' }}>
              If this doesn't load, the other app may block embedding — use "Open in new tab" instead.
            </div>
          </div>
        </div>
      )}

      {unconfirmedDevices.length > 0 && (
        <div style={{
          position: 'fixed', right: 190, bottom: 16, width: 300, maxHeight: 380,
          background: '#fff', border: '0.5px solid #F0D488', borderRadius: 10,
          boxShadow: '0 4px 18px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column',
          zIndex: 40, overflow: 'hidden',
        }}>
          <div style={{ padding: '9px 12px', background: '#FFF7E6', borderBottom: '0.5px solid #F0D488', display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ti ti-scan" style={{ color: '#BA7517', fontSize: 15 }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: '#5A4200', flex: 1, lineHeight: 1.3 }}>
              {unconfirmedDevices.length} detected device{unconfirmedDevices.length === 1 ? '' : 's'} to review
            </div>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {unconfirmedDevices.map(d => (
              <div key={d.id} style={{ padding: '7px 12px', borderBottom: '0.5px solid #f0efe9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <div onClick={() => handleDeviceSelect(d.id)} title="Locate on canvas"
                    style={{ width: 26, height: 26, borderRadius: 6, background: d.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                    <DeviceIcon dtype={d.dtype} color={d.color} size={18} />
                  </div>
                  <select value={d.dtype} onChange={e => retypeDetectedDevice(d.id, e.target.value)}
                    style={{ fontSize: 11, flex: 1, border: '0.5px solid #ddd', borderRadius: 4, padding: '3px 4px', minWidth: 0 }}>
                    {DEVICE_DEFS.flatMap(section => section.items).map(item => (
                      <option key={item.dtype} value={item.dtype}>{item.label}</option>
                    ))}
                  </select>
                  <button onClick={() => confirmDetectedDevice(d.id)} title="Confirm this device"
                    style={{ background: 'none', border: 'none', color: '#1D9E75', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                    <i className="ti ti-check" style={{ fontSize: 15 }} />
                  </button>
                  <button onClick={() => discardDetectedDevice(d.id)} title="Discard — not a real device"
                    style={{ background: 'none', border: 'none', color: '#A32D2D', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                    <i className="ti ti-x" style={{ fontSize: 15 }} />
                  </button>
                </div>
                <input value={d.label} placeholder="Label (e.g. IDF 1-1)" onChange={e => relabelDetectedDevice(d.id, e.target.value)}
                  style={{ fontSize: 11, width: '100%', border: '0.5px solid #ddd', borderRadius: 4, padding: '3px 6px', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '0.5px solid #f0efe9' }}>
            <button onClick={confirmAllDetectedDevices} style={{ ...tbBtn, flex: 1, justifyContent: 'center', color: '#1D9E75', borderColor: '#9AD9BE' }}>
              <i className="ti ti-checks" /> Confirm all
            </button>
            <button onClick={discardAllDetectedDevices} style={{ ...tbBtn, flex: 1, justifyContent: 'center', color: '#A32D2D', borderColor: '#F09595' }}>
              <i className="ti ti-trash" /> Discard all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Modal({ children, onClose, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: wide ? 480 : 380, maxHeight: '80vh', overflowY: 'auto', border: '0.5px solid #e0dfd8' }}>
        {children}
      </div>
    </div>
  )
}

const tbBtn = { background: '#fff', border: '0.5px solid #ccc', borderRadius: 6, padding: '5px 9px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: '#1a1a18', whiteSpace: 'nowrap' }
const activeTbBtn = { borderColor: '#378ADD', color: '#378ADD', background: '#E6F1FB' }
const ghostBtn = { padding: '7px 14px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 12, cursor: 'pointer' }
const primaryBtn = { padding: '7px 14px', background: '#378ADD', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer' }
const dangerBtn = { padding: '6px', background: '#FCEBEB', color: '#A32D2D', border: '0.5px solid #F09595', borderRadius: 7, fontSize: 12, cursor: 'pointer', marginTop: 2 }
const ghostBtnSmall = { padding: '6px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 12, cursor: 'pointer' }
const propLabel = { display: 'block', fontSize: 11, color: '#666', marginBottom: 3 }
const propInput = { width: '100%', fontSize: 12, padding: '5px 7px', border: '0.5px solid #ccc', borderRadius: 6, background: '#fff', color: '#1a1a18', boxSizing: 'border-box', outline: 'none' }
const modalTitle = { fontSize: 15, fontWeight: 500, marginBottom: 12, color: '#1a1a18', margin: '0 0 12px' }
const bomCell = { padding: '6px 8px', borderBottom: '0.5px solid #e0dfd8', color: '#1a1a18' }

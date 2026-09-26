import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getSurvey, getProject, saveSurvey } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fitGeoTransform, computeCorners, estimateScale } from '../lib/geo'
import { rotatedImageOverlay } from '../lib/RotatedImageOverlay'
import { geocodeAddress } from '../lib/geocode'

const SATELLITE_LAYER = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri — Esri, Maxar, Earthstar Geographics',
  // Esri's actual imagery resolution tops out around zoom 19 in most
  // US locations (sometimes lower in rural areas). Without
  // maxNativeZoom, Leaflet keeps asking for tiles at higher {z} values
  // that don't exist and just shows nothing past that point — which
  // looks like "I can't zoom in any further." Setting maxNativeZoom
  // lets it keep zooming past that by upscaling the last real tile
  // (a bit blurry, but still usable for placing a control point) —
  // the same trick Google Maps and similar apps use.
  maxNativeZoom: 19,
}
const STREET_LAYER = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  maxNativeZoom: 19,
}

// A handful of distinguishable colors so a control point drawn on the
// floor plan and its matching pin on the map are obviously the same
// pair, even with several points on screen at once.
const POINT_COLORS = ['#E23D3D', '#378ADD', '#1D9E75', '#BA7517', '#8B5CF6', '#D63384', '#0EA5E9', '#65A30D']

const PIXEL_DENSITY = 2 // matches SurveyCanvas's crisp-render factor

export default function GeoReference() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [survey, setSurvey] = useState(null)
  const [siteLocation, setSiteLocation] = useState(null) // { lat, lng } for this survey's project address, once known
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [points, setPoints] = useState([]) // [{id, px, py, lat, lng}]
  const [pendingPixel, setPendingPixel] = useState(null) // waiting for a map click to complete the pair
  const [pendingLatLng, setPendingLatLng] = useState(null) // waiting for a floor-plan click to complete the pair
  const [opacity, setOpacity] = useState(0.7)
  const [basemap, setBasemap] = useState('satellite')
  const [planZoom, setPlanZoom] = useState(100)

  // Dimensions of the floor plan in the same coordinate space the rest
  // of the app uses for device x/y — i.e. after accounting for
  // floor_plan_rotation, NOT necessarily the raw source file's own
  // width/height. Control points and MDF/IDF pins are only correct if
  // they're measured in this space.
  const [displayDims, setDisplayDims] = useState(null) // { w, h }
  const [overlayImageSrc, setOverlayImageSrc] = useState(null) // dataURL fed to the map overlay
  const [planLoadError, setPlanLoadError] = useState('')

  const planCanvasRef = useRef(null)
  const planContainerRef = useRef(null)
  const sourceRef = useRef(null) // { kind: 'image'|'pdf', img?, canvas?, displayScale? }
  const mapDivRef = useRef(null)
  const mapRef = useRef(null)
  const tileLayerRef = useRef(null)
  const overlayLayerRef = useRef(null)
  const pointMarkersRef = useRef([]) // leaflet markers for control points
  const devicePinsRef = useRef([]) // leaflet markers for MDF/IDF preview pins

  useEffect(() => { loadSurvey() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSurvey() {
    setLoading(true)
    const { data, error } = await getSurvey(id)
    if (error || !data) { setError('Survey not found.'); setLoading(false); return }
    if (!data.floor_plan_url) { setError('This survey has no floor plan uploaded yet — add one before georeferencing it.'); setLoading(false); return }
    setSurvey(data)
    setPoints((data.geo_points || []).map(p => ({ id: p.id || uuidv4(), ...p })))
    setOpacity(typeof data.geo_opacity === 'number' ? data.geo_opacity : 0.7)
    setLoading(false)

    // Jump the map to the project's site address, if it has one — no
    // more hunting for the building by hand. If the address was saved
    // before it could be geocoded (e.g. the geocoder was briefly down),
    // fall back to geocoding it live here instead of leaving the map
    // stuck at the generic default.
    if (data.project_id) {
      const { data: project } = await getProject(data.project_id)
      if (project?.address_lat != null && project?.address_lng != null) {
        setSiteLocation({ lat: project.address_lat, lng: project.address_lng })
      } else if (project?.address) {
        const { lat, lng } = await geocodeAddress(project.address)
        if (lat != null) setSiteLocation({ lat, lng })
      }
    }
  }

  // ── Load the floor plan source (image or PDF page) and draw it ─────
  // Mirrors SurveyCanvas's loading logic exactly, so control points
  // placed here and device x/y placed in the editor share one
  // coordinate space. A PDF can't be dropped into an <img> tag, and a
  // rotated plan isn't rotated in the stored file itself — both have
  // to be rendered onto our own canvas the same way the editor does.
  useEffect(() => {
    if (!survey?.floor_plan_url) return
    let cancelled = false
    setPlanLoadError('')

    const floorPlanUrl = survey.floor_plan_url
    const floorPlanPage = survey.floor_plan_page || 1
    const isPDF = floorPlanUrl.includes('.pdf') || (floorPlanUrl.includes('%2F') && !floorPlanUrl.match(/\.(jpg|jpeg|png|gif|webp)/i))

    async function loadPDF() {
      try {
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            s.onload = resolve; s.onerror = reject
            document.head.appendChild(s)
          })
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        const pdf = await window.pdfjsLib.getDocument(floorPlanUrl).promise
        const pageNum = Math.min(Math.max(1, floorPlanPage), pdf.numPages)
        const page = await pdf.getPage(pageNum)
        const RENDER_SCALE = 3
        const vp = page.getViewport({ scale: RENDER_SCALE })
        const raw = document.createElement('canvas')
        raw.width = Math.round(vp.width)
        raw.height = Math.round(vp.height)
        await page.render({ canvasContext: raw.getContext('2d'), viewport: vp }).promise
        if (cancelled) return
        sourceRef.current = { kind: 'pdf', canvas: raw, displayScale: 1 / RENDER_SCALE }
        drawFloorPlan()
      } catch (err) {
        console.error('PDF render error:', err)
        if (!cancelled) setPlanLoadError('Could not render this PDF floor plan.')
      }
    }

    function loadImage() {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (cancelled) return
        sourceRef.current = { kind: 'image', img }
        drawFloorPlan()
      }
      img.onerror = () => { if (!cancelled) setPlanLoadError('Could not load this floor plan image.') }
      img.src = floorPlanUrl
    }

    if (isPDF) loadPDF(); else loadImage()
    return () => { cancelled = true }
  }, [survey?.floor_plan_url, survey?.floor_plan_page]) // eslint-disable-line react-hooks/exhaustive-deps

  // Draws the loaded source onto our canvas at the survey's saved
  // rotation, in "display" pixel space — the exact same space
  // SurveyCanvas uses for device x/y — then snapshots it as a data URL
  // for the map overlay to use as its image.
  function drawFloorPlan() {
    const source = sourceRef.current
    const canvas = planCanvasRef.current
    if (!source || !canvas) return
    const rotNorm = ((survey?.floor_plan_rotation || 0) % 360 + 360) % 360
    const isRotated90 = rotNorm === 90 || rotNorm === 270
    const ctx = canvas.getContext('2d')

    let srcW, srcH, drawSource
    if (source.kind === 'image') {
      srcW = source.img.naturalWidth; srcH = source.img.naturalHeight; drawSource = source.img
    } else {
      srcW = source.canvas.width * source.displayScale; srcH = source.canvas.height * source.displayScale; drawSource = source.canvas
    }
    const displayW = isRotated90 ? srcH : srcW
    const displayH = isRotated90 ? srcW : srcH

    canvas.width = Math.round(displayW * PIXEL_DENSITY)
    canvas.height = Math.round(displayH * PIXEL_DENSITY)
    const rad = (rotNorm * Math.PI) / 180
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(rad)
    ctx.drawImage(drawSource, -srcW * PIXEL_DENSITY / 2, -srcH * PIXEL_DENSITY / 2, srcW * PIXEL_DENSITY, srcH * PIXEL_DENSITY)
    ctx.restore()

    setDisplayDims({ w: displayW, h: displayH })
    setOverlayImageSrc(canvas.toDataURL('image/png'))
  }

  // ── Map setup ────────────────────────────────────────────────────────
  // Deliberately NOT a mount-once ([]) effect: while `loading` is still
  // true, this component renders the "Loading…" branch instead of the
  // real layout, so mapDivRef.current doesn't exist in the DOM yet. A
  // [] effect would run exactly once, right then, see no div, and bail
  // out for good — leaving the map permanently uncreated even after the
  // real layout mounts a moment later. Re-running once loading flips to
  // false (and the map's div actually exists) is what makes it work;
  // the mapRef.current guard below still ensures it only ever runs once
  // in practice.
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    const map = L.map(mapDivRef.current, { zoomControl: true }).setView([34.0, -96.37], 17) // Durant, OK default; pan/zoom to the real site
    const layer = SATELLITE_LAYER
    tileLayerRef.current = L.tileLayer(layer.url, { attribution: layer.attribution, maxZoom: 22, maxNativeZoom: layer.maxNativeZoom }).addTo(map)
    map.on('click', e => handleMapClickRef.current(e.latlng.lat, e.latlng.lng))
    mapRef.current = map

    // Leaflet measures its container's pixel size the instant it's
    // created. In a flex layout, that container can still be mid-layout
    // (briefly zero-sized) at that exact moment — Leaflet then renders
    // tiles for a 0x0 area and never repaints on its own once the
    // container actually gets its real size. invalidateSize() forces it
    // to re-measure and redraw. A ResizeObserver keeps this correct if
    // the pane is resized later too (window resize, sidebar toggling).
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(mapDivRef.current)
    // Also nudge it once on the next frame, in case the observer's
    // first callback doesn't fire before the browser's first paint.
    requestAnimationFrame(() => map.invalidateSize())

    return () => { ro.disconnect(); map.remove(); mapRef.current = null }
  }, [loading, error])

  // Switch basemap tile layer without tearing down the whole map.
  useEffect(() => {
    if (!mapRef.current) return
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current)
    const layer = basemap === 'satellite' ? SATELLITE_LAYER : STREET_LAYER
    tileLayerRef.current = L.tileLayer(layer.url, { attribution: layer.attribution, maxZoom: 22, maxNativeZoom: layer.maxNativeZoom }).addTo(mapRef.current)
  }, [basemap])

  // If this survey was already georeferenced, jump the map to it so
  // the person doesn't have to hunt for their building again.
  useEffect(() => {
    if (!mapRef.current || !survey?.geo_corners) return
    const c = survey.geo_corners
    const bounds = L.latLngBounds([c.topLeft, c.topRight, c.bottomLeft])
    mapRef.current.fitBounds(bounds, { padding: [80, 80] })
  }, [survey])

  // Otherwise, if the project has a known site address, center there
  // instead of the generic default — this is what actually saves the
  // "hunt around the map for my building" step.
  useEffect(() => {
    if (!mapRef.current || !siteLocation || survey?.geo_corners) return
    mapRef.current.setView([siteLocation.lat, siteLocation.lng], 19)
  }, [siteLocation, survey])

  // ── Transform: recomputed any time the control points change ───────
  const transform = useMemo(() => (points.length >= 2 ? fitGeoTransform(points) : null), [points])
  const corners = useMemo(() => {
    if (!transform || !displayDims) return null
    return computeCorners(transform, displayDims.w, displayDims.h)
  }, [transform, displayDims])

  // Real-world scale derived from the satellite-verified control
  // points, in the same px/ft unit the main editor uses for coverage
  // and heatmap math — computed here so it can be pushed into the
  // survey's actual px_per_ft field instead of sitting unused.
  const scaleEstimate = useMemo(() => estimateScale(transform), [transform])
  const [scaleApplied, setScaleApplied] = useState(false)
  const [applyingScale, setApplyingScale] = useState(false)

  async function handleApplyScale() {
    if (!scaleEstimate?.pxPerFt) return
    setApplyingScale(true)
    const { error: saveFailure } = await saveSurvey(id, { px_per_ft: scaleEstimate.pxPerFt }, { updatedBy: user?.id })
    setApplyingScale(false)
    if (saveFailure) { setError('Could not apply scale: ' + saveFailure.message); return }
    setSurvey(s => ({ ...s, px_per_ft: scaleEstimate.pxPerFt }))
    setScaleApplied(true)
    setTimeout(() => setScaleApplied(false), 2500)
  }

  // ── Draw / update the floor plan overlay on the map ─────────────────
  useEffect(() => {
    if (!mapRef.current) return
    if (!corners || !overlayImageSrc) {
      if (overlayLayerRef.current) { mapRef.current.removeLayer(overlayLayerRef.current); overlayLayerRef.current = null }
      return
    }
    if (!overlayLayerRef.current) {
      overlayLayerRef.current = rotatedImageOverlay(overlayImageSrc, corners, { opacity }).addTo(mapRef.current)
    } else {
      overlayLayerRef.current.setCorners(corners)
    }
  }, [corners, overlayImageSrc, opacity])

  useEffect(() => {
    if (overlayLayerRef.current) overlayLayerRef.current.setOpacity(opacity)
  }, [opacity])

  // ── Draw control point pins on the map ──────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    pointMarkersRef.current.forEach(m => mapRef.current.removeLayer(m))
    pointMarkersRef.current = points.map((p, i) => {
      const color = POINT_COLORS[i % POINT_COLORS.length]
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;font-family:sans-serif;cursor:grab;">${i + 1}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
      })
      return L.marker([p.lat, p.lng], { icon, draggable: true })
        .on('drag', e => updatePoint(p.id, { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }))
        .addTo(mapRef.current)
    })
    if (pendingLatLng) {
      const icon = L.divIcon({ className: '', html: `<div style="width:26px;height:26px;border-radius:50%;background:rgba(186,117,23,0.35);border:3px solid #BA7517;box-shadow:0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.5);"></div>`, iconSize: [26, 26], iconAnchor: [13, 13] })
      pointMarkersRef.current.push(L.marker([pendingLatLng.lat, pendingLatLng.lng], { icon }).addTo(mapRef.current))
    }
  }, [points, pendingLatLng]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Preview MDF/IDF pins in real-world position, once georeferenced ─
  useEffect(() => {
    if (!mapRef.current) return
    devicePinsRef.current.forEach(m => mapRef.current.removeLayer(m))
    devicePinsRef.current = []
    if (!transform || !survey?.devices) return
    const nodes = survey.devices.filter(d => d.dtype === 'mdf' || d.dtype === 'idf')
    devicePinsRef.current = nodes.map(d => {
      const { lat, lng } = transform.apply(d.x, d.y)
      const color = d.dtype === 'mdf' ? '#C21E7A' : '#E85BAE'
      const icon = L.divIcon({
        className: '',
        html: `<div style="padding:2px 6px;border-radius:4px;background:${color};border:1px solid #fff;color:#fff;font-size:10px;font-weight:700;font-family:monospace;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${d.dtype.toUpperCase()}${d.label ? ' · ' + d.label : ''}</div>`,
        iconSize: null, iconAnchor: [0, 20],
      })
      return L.marker([lat, lng], { icon }).addTo(mapRef.current)
    })
  }, [transform, survey])

  // ── Click handlers ───────────────────────────────────────────────────
  function addPoint(p) { setPoints(prev => [...prev, { id: uuidv4(), ...p }]) }
  function updatePoint(pid, patch) { setPoints(prev => prev.map(p => p.id === pid ? { ...p, ...patch } : p)) }
  function removePoint(pid) { setPoints(prev => prev.filter(p => p.id !== pid)) }

  function handleMapClick(lat, lng) {
    if (pendingPixel) {
      addPoint({ px: pendingPixel.px, py: pendingPixel.py, lat, lng })
      setPendingPixel(null)
    } else {
      setPendingLatLng({ lat, lng })
    }
  }
  // Kept in a ref so the Leaflet click listener (bound once, on map
  // creation) always calls the latest version of this handler without
  // needing to tear down and rebind the map on every render.
  const handleMapClickRef = useRef(handleMapClick)
  useEffect(() => { handleMapClickRef.current = handleMapClick }) // eslint-disable-line react-hooks/exhaustive-deps

  function handlePlanClick(e) {
    const canvas = planCanvasRef.current
    if (!canvas || !displayDims) return
    const rect = canvas.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return
    const px = relX * displayDims.w
    const py = relY * displayDims.h
    if (pendingLatLng) {
      addPoint({ px, py, lat: pendingLatLng.lat, lng: pendingLatLng.lng })
      setPendingLatLng(null)
    } else {
      setPendingPixel({ px, py })
    }
  }

  // Lets a placed control point be dragged to a new spot on the floor
  // plan, instead of the only fix being delete-and-reclick. Implemented
  // by hand (not native HTML5 drag) since the marker is just an
  // absolutely-positioned div over a canvas — plain mousedown/mousemove/
  // mouseup (and touch equivalents) tracked on the window is the most
  // reliable way to keep the marker following the cursor even if it
  // moves faster than the div's own hit area.
  function startDragPoint(e, pointId) {
    e.preventDefault()
    e.stopPropagation()
    const canvas = planCanvasRef.current
    if (!canvas || !displayDims) return

    const getClientPos = (evt) => {
      const t = evt.touches?.[0] || evt.changedTouches?.[0]
      return t ? { x: t.clientX, y: t.clientY } : { x: evt.clientX, y: evt.clientY }
    }

    function onMove(evt) {
      evt.preventDefault()
      const { x, y } = getClientPos(evt)
      const rect = canvas.getBoundingClientRect()
      const relX = Math.min(1, Math.max(0, (x - rect.left) / rect.width))
      const relY = Math.min(1, Math.max(0, (y - rect.top) / rect.height))
      updatePoint(pointId, { px: relX * displayDims.w, py: relY * displayDims.h })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
  }

  const handleSave = useCallback(async () => {
    setSaving(true)
    const payload = { geo_points: points, geo_corners: corners || null, geo_opacity: opacity }
    const { error: saveFailure } = await saveSurvey(id, payload, { updatedBy: user?.id })
    setSaving(false)
    if (saveFailure) { setError('Save failed: ' + saveFailure.message); return }
    setSaveMsg('Saved'); setTimeout(() => setSaveMsg(''), 2000)
  }, [id, points, corners, opacity, user])

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: 14, color: '#888' }}>Loading…</div>
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 14 }}>
        <div style={{ color: '#A32D2D', fontSize: 14 }}>{error}</div>
        <button onClick={() => navigate(`/survey/${id}`)} style={ghostBtn}>Back to survey</button>
      </div>
    )
  }

  const nextClickHint = pendingPixel
    ? 'Now click the matching spot on the map →'
    : pendingLatLng
      ? '← Now click the matching point on the floor plan'
      : 'Click a point on the floor plan, then its matching spot on the map'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`@keyframes geo-pending-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.15); opacity: 0.7; } }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '0.5px solid #e0dfd8', background: '#fff', flexShrink: 0 }}>
        <button onClick={() => navigate(`/survey/${id}`)} style={ghostBtn}><i className="ti ti-arrow-left" /> Back</button>
        <div style={{ width: '0.5px', height: 22, background: '#e0dfd8' }} />
        <strong style={{ fontSize: 14 }}>{survey?.name} — Georeference</strong>
        {siteLocation && !survey?.geo_corners && (
          <span style={{ fontSize: 11, color: '#1D9E75' }}><i className="ti ti-map-pin" /> Map centered on site address</span>
        )}
        <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>{nextClickHint}</span>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 6 }}>
          Basemap
          <select value={basemap} onChange={e => setBasemap(e.target.value)} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '0.5px solid #ccc' }}>
            <option value="satellite">Satellite (Esri, no key needed)</option>
            <option value="street">Street (OpenStreetMap)</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 6 }}>
          Overlay opacity
          <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} style={{ width: 90 }} />
        </label>
        <span style={{ fontSize: 11, color: '#888' }}>
          {points.length} point{points.length !== 1 ? 's' : ''}{transform ? ` · ${points.length >= 3 ? 'affine' : 'similarity'} fit` : ' · need 2+ to preview'}
        </span>
        <button onClick={handleSave} disabled={saving} style={primaryBtn}>
          <i className="ti ti-device-floppy" /> {saving ? 'Saving…' : (saveMsg || 'Save')}
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Floor plan pane */}
        <div style={{ width: '38%', display: 'flex', flexDirection: 'column', borderRight: '0.5px solid #e0dfd8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '0.5px solid #e0dfd8', fontSize: 11, color: '#888' }}>
            Floor plan
            <span style={{ flex: 1 }} />
            <button onClick={() => setPlanZoom(z => Math.max(25, z - 25))} style={ghostBtnSmall}><i className="ti ti-zoom-out" /></button>
            <span>{planZoom}%</span>
            <button onClick={() => setPlanZoom(z => Math.min(1600, z + (z >= 400 ? 100 : 25)))} style={ghostBtnSmall}><i className="ti ti-zoom-in" /></button>
          </div>
          <div ref={planContainerRef} style={{ flex: 1, overflow: 'auto', background: '#f2f2ef', position: 'relative' }}>
            {planLoadError && <div style={{ padding: 20, color: '#A32D2D', fontSize: 12 }}>{planLoadError}</div>}
            <div style={{ position: 'relative', width: displayDims ? displayDims.w * (planZoom / 100) : 'auto', height: displayDims ? displayDims.h * (planZoom / 100) : 'auto' }}>
              <canvas
                ref={planCanvasRef}
                onClick={handlePlanClick}
                style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
              />
              {pendingPixel && displayDims && (
                <div style={{
                  position: 'absolute', pointerEvents: 'none',
                  left: `${(pendingPixel.px / displayDims.w) * 100}%`,
                  top: `${(pendingPixel.py / displayDims.h) * 100}%`,
                  width: 26, height: 26, marginLeft: -13, marginTop: -13,
                  borderRadius: '50%', background: 'rgba(186,117,23,0.25)',
                  border: '3px solid #BA7517', boxShadow: '0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.5)',
                  animation: 'geo-pending-pulse 1.2s ease-in-out infinite',
                }} />
              )}
              {displayDims && points.map((p, i) => (
                <div
                  key={p.id}
                  onMouseDown={e => startDragPoint(e, p.id)}
                  onTouchStart={e => startDragPoint(e, p.id)}
                  title="Drag to reposition"
                  style={{
                    position: 'absolute', cursor: 'grab', touchAction: 'none',
                    left: `${(p.px / displayDims.w) * 100}%`,
                    top: `${(p.py / displayDims.h) * 100}%`,
                    width: 30, height: 30, marginLeft: -15, marginTop: -15,
                    borderRadius: '50%', background: POINT_COLORS[i % POINT_COLORS.length],
                    border: '3px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 12, fontWeight: 700, userSelect: 'none',
                  }}
                >{i + 1}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Map pane */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div ref={mapDivRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Points list */}
        <div style={{ width: 260, borderLeft: '0.5px solid #e0dfd8', overflow: 'auto', background: '#fff', flexShrink: 0 }}>
          <div style={{ padding: '10px 12px', fontSize: 11, color: '#888', borderBottom: '0.5px solid #e0dfd8' }}>
            Control points — need at least 2 (3+ for a tighter fit if the scan isn't perfectly square).
          </div>
          {points.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: '#aaa' }}>No points yet.</div>
          )}
          {points.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '0.5px solid #f0efe9', fontSize: 11 }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: POINT_COLORS[i % POINT_COLORS.length], flexShrink: 0 }} />
              <div style={{ flex: 1, color: '#444' }}>
                <div>plan: {Math.round(p.px)}, {Math.round(p.py)}</div>
                <div>geo: {p.lat.toFixed(6)}, {p.lng.toFixed(6)}</div>
              </div>
              <button onClick={() => removePoint(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc' }}>
                <i className="ti ti-trash" />
              </button>
            </div>
          ))}
          {(pendingPixel || pendingLatLng) && (
            <div style={{ padding: 10, fontSize: 11, color: '#BA7517', background: '#FFF7E6' }}>
              {nextClickHint}
              <button onClick={() => { setPendingPixel(null); setPendingLatLng(null) }} style={{ ...ghostBtnSmall, marginTop: 6, width: '100%' }}>Cancel</button>
            </div>
          )}
          {survey?.devices?.some(d => d.dtype === 'mdf' || d.dtype === 'idf') && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: '#888', borderTop: '0.5px solid #e0dfd8', marginTop: 8 }}>
              {transform
                ? 'MDF/IDF pins are previewed on the map at their real-world position.'
                : 'Add 2+ points to preview MDF/IDF pins at their real-world position.'}
            </div>
          )}
          {scaleEstimate?.pxPerFt && (
            <div style={{ padding: '10px 12px', borderTop: '0.5px solid #e0dfd8', fontSize: 11, color: '#444' }}>
              <div style={{ color: '#888', marginBottom: 4 }}>Scale, from your control points:</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{scaleEstimate.pxPerFt.toFixed(2)} px/ft</div>
              <div style={{ color: '#888', marginTop: 2 }}>
                Currently on this floor plan: {typeof survey?.px_per_ft === 'number' ? `${survey.px_per_ft.toFixed(2)} px/ft` : 'not set'}
              </div>
              {scaleEstimate.skewPct > 5 && (
                <div style={{ color: '#BA7517', marginTop: 6, fontSize: 10.5 }}>
                  <i className="ti ti-alert-triangle" /> Horizontal and vertical scale disagree by {scaleEstimate.skewPct.toFixed(0)}% — double-check your control points, or the scan itself may be stretched.
                </div>
              )}
              <button
                onClick={handleApplyScale}
                disabled={applyingScale}
                style={{ ...primaryBtn, width: '100%', justifyContent: 'center', marginTop: 8, fontSize: 11, padding: '6px 10px' }}
              >
                <i className="ti ti-ruler-2" /> {applyingScale ? 'Applying…' : (scaleApplied ? 'Applied ✓' : 'Apply this scale to the floor plan')}
              </button>
              <div style={{ color: '#aaa', marginTop: 6, fontSize: 10 }}>
                This updates px_per_ft on this survey — the same scale used for heat maps, coverage circles, and measurements in the editor.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ghostBtn = { padding: '7px 14px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }
const ghostBtnSmall = { padding: '5px 8px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 6, fontSize: 11, cursor: 'pointer' }
const primaryBtn = { padding: '7px 14px', background: '#1a1a18', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }

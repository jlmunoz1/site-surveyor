import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { getIconPaths, CABLE_STYLES, DEVICE_STATUSES } from '../lib/devices'

const SurveyCanvas = forwardRef(function SurveyCanvas({
  devices, cables, svgMarkup, pxPerFt, showHeatmap,
  mode, activeCableType,
  onDeviceAdd, onDeviceMove, onDeviceSelect,
  onCableAdd, onCableSelect,
  onMarkupChange,
  selectedId, selectedCableId,
  floorPlanUrl,
  floorPlanPage = 1,
  floorPlanRotation = 0,
  iconSizes = { cameras: 16, lora: 20, network: 20, access: 16 },
  labelSizes = { cameras: 10, lora: 13, network: 10, access: 10 },
  hiddenLabelTypes = [],
  heatmapOpacity = 0.8,
  calibrating = false,
  measuring = false,
  onCalibrateDrag,
  readOnly = false,
  // Fired once the floor plan (if any) has finished loading and been
  // drawn — or immediately if there's no floor plan at all. Used by
  // the bulk PDF export flow to know exactly when it's safe to
  // screenshot this canvas, since floor plan loading (image fetch, or
  // PDF.js page rendering) is asynchronous and would otherwise
  // sometimes get captured mid-load as a blank canvas.
  onFloorPlanReady,
}, ref) {
  const wrapRef = useRef(null)
  const fpCanvasRef = useRef(null)
  const hmCanvasRef = useRef(null)
  const drawSvgRef = useRef(null)
  const [drawingCable, setDrawingCable] = useState(null)
  const [tempLine, setTempLine] = useState(null)
  const [drawStart, setDrawStart] = useState(null)
  const [drawEl, setDrawEl] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const baseZoomRef = useRef(null) // the current "fit to window" zoom — null until first computed
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const panOrigin = useRef({ x: 0, y: 0 })
  const isCalibratingDrag = useRef(false)
  const calibStartRef = useRef({ x: 0, y: 0 })
  const [calibDrag, setCalibDrag] = useState(null) // { x1, y1, x2, y2 } while actively dragging
  const isMeasuringDrag = useRef(false)
  const measureStartRef = useRef({ x: 0, y: 0 })
  const [measureLine, setMeasureLine] = useState(null) // { x1, y1, x2, y2, distFt } — persists after mouseup so it can be read

  // Clear the measurement line whenever the tool is switched off
  useEffect(() => {
    if (!measuring) setMeasureLine(null)
  }, [measuring])
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })

  // Exposes the floor plan's current on-screen bounding box (relative
  // to the wrapper), so the parent can crop an export capture to just
  // the floor plan instead of the whole viewport — which often has a
  // lot of empty space around a centered floor plan of a different
  // aspect ratio than the browser window.
  useImperativeHandle(ref, () => ({
    getFloorPlanBounds() {
      const canvas = fpCanvasRef.current
      if (!canvas) return null
      const cw = parseFloat(canvas.style.width) || 0
      const ch = parseFloat(canvas.style.height) || 0
      if (!cw || !ch) return null
      return {
        left: panRef.current.x,
        top: panRef.current.y,
        width: cw * zoomRef.current,
        height: ch * zoomRef.current,
      }
    },
  }))
  // Caches the already-loaded floor plan source (image or rendered PDF
  // page) so that rotating doesn't have to re-fetch/re-render from
  // scratch every time — only redraw. Re-loading on rotation was what
  // caused the floor plan to flash back to its original orientation
  // before snapping to the new one.
  const loadedSourceRef = useRef(null) // { kind: 'image'|'pdf', img?, canvas?, displayScale? }
  const loadedUrlRef = useRef(null)

  // Keep refs in sync for event handlers
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  // Draw the cached floor plan source onto the visible canvas at the
  // given rotation. Pure redraw — no network/render work.
  const drawFloorPlanAtRotation = useCallback((rot) => {
    const source = loadedSourceRef.current
    const canvas = fpCanvasRef.current
    if (!source || !canvas || !wrapRef.current) return
    const ctx = canvas.getContext('2d')
    const rotNorm = ((rot || 0) % 360 + 360) % 360
    const isRotated90 = rotNorm === 90 || rotNorm === 270

    if (source.kind === 'image') {
      const image = source.img
      const srcW = image.naturalWidth, srcH = image.naturalHeight
      const displayW = isRotated90 ? srcH : srcW
      const displayH = isRotated90 ? srcW : srcH
      // Fixed pixel density for sharpness — deliberately NOT based on
      // the current window size. Baking the "fit to window" ratio into
      // the canvas's own CSS pixel dimensions meant device coordinates
      // (stored relative to this size) landed in a different relative
      // spot on the floor plan any time the window size differed
      // between sessions — devices appeared to "move" on reopening.
      // Now the floor plan always renders at a fixed, deterministic
      // size (its own natural pixels), and "fit to window" is handled
      // purely as a zoom level instead (see getBaseZoom below).
      const PIXEL_DENSITY = 2
      canvas.width = Math.round(displayW * PIXEL_DENSITY)
      canvas.height = Math.round(displayH * PIXEL_DENSITY)
      canvas.style.width = displayW + 'px'
      canvas.style.height = displayH + 'px'
      const rad = (rotNorm * Math.PI) / 180
      ctx.save()
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(rad)
      ctx.drawImage(image, -srcW * PIXEL_DENSITY / 2, -srcH * PIXEL_DENSITY / 2, srcW * PIXEL_DENSITY, srcH * PIXEL_DENSITY)
      ctx.restore()
    } else if (source.kind === 'pdf') {
      const raw = source.canvas
      const displayScale = source.displayScale
      const outW = isRotated90 ? raw.height : raw.width
      const outH = isRotated90 ? raw.width : raw.height
      canvas.width = outW
      canvas.height = outH
      canvas.style.width = Math.round(outW * displayScale) + 'px'
      canvas.style.height = Math.round(outH * displayScale) + 'px'
      ctx.save()
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((rotNorm * Math.PI) / 180)
      ctx.drawImage(raw, -raw.width / 2, -raw.height / 2)
      ctx.restore()
    }

    // Snap to the fitted "base" zoom (and center) whenever the person
    // is currently at that locked baseline — i.e. hasn't manually
    // zoomed in. Runs on first load (fitting the floor plan to the
    // window) and again after rotation (swapping width/height changes
    // what "fit" means), but leaves an intentionally zoomed-in view
    // alone. The floor plan itself now always renders at a fixed,
    // deterministic size (see the sizing above) — "fit to window" is
    // handled entirely here, as a zoom level, rather than baked into
    // the canvas's own pixel dimensions like before.
    if (wrapRef.current) {
      const isFirstDraw = baseZoomRef.current === null
      const wasAtBase = !isFirstDraw && Math.abs(zoomRef.current - baseZoomRef.current) < 0.001
      const newBase = getBaseZoom()
      if (isFirstDraw || wasAtBase) {
        const centered = getCenterOffset(newBase)
        zoomRef.current = newBase
        panRef.current = centered
        setZoom(newBase)
        setPan(centered)
      }
      baseZoomRef.current = newBase
    }
  }, [])

  // Load the floor plan source (only when the URL actually changes)
  useEffect(() => {
    if (!fpCanvasRef.current) return
    const canvas = fpCanvasRef.current
    const ctx = canvas.getContext('2d')

    if (!floorPlanUrl) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      canvas.width = 0
      canvas.height = 0
      canvas.style.width = '0px'
      canvas.style.height = '0px'
      loadedSourceRef.current = null
      loadedUrlRef.current = null
      onFloorPlanReady?.()
      return
    }

    if (loadedUrlRef.current === `${floorPlanUrl}#${floorPlanPage}` && loadedSourceRef.current) {
      // Already loaded — just draw at the current rotation.
      drawFloorPlanAtRotation(floorPlanRotation)
      onFloorPlanReady?.()
      return
    }

    if (!wrapRef.current) return
    const isPDF = floorPlanUrl.includes('.pdf') || (floorPlanUrl.includes('%2F') && !floorPlanUrl.match(/\.(jpg|jpeg|png|gif|webp)/i))

    if (isPDF) {
      const loadPDF = async () => {
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
          const pageNum = Math.min(Math.max(1, floorPlanPage || 1), pdf.numPages)
          const page = await pdf.getPage(pageNum)
          const RENDER_SCALE = 3
          const vp = page.getViewport({ scale: RENDER_SCALE })
          const raw = document.createElement('canvas')
          raw.width = Math.round(vp.width)
          raw.height = Math.round(vp.height)
          // Fixed, deterministic CSS display scale — converts the
          // high-resolution render buffer back down to roughly "1 PDF
          // point = 1 CSS pixel". Deliberately NOT based on the current
          // window size; see the comment in drawFloorPlanAtRotation for
          // why baking window size into this caused devices to appear
          // to move between sessions.
          const displayScale = 1 / RENDER_SCALE
          await page.render({ canvasContext: raw.getContext('2d'), viewport: vp }).promise

          loadedSourceRef.current = { kind: 'pdf', canvas: raw, displayScale }
          loadedUrlRef.current = `${floorPlanUrl}#${floorPlanPage}`
          drawFloorPlanAtRotation(floorPlanRotation)
          onFloorPlanReady?.()
        } catch (err) { console.error('PDF render error:', err) }
      }
      loadPDF()
    } else {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      const onReady = (image) => {
        loadedSourceRef.current = { kind: 'image', img: image }
        loadedUrlRef.current = `${floorPlanUrl}#${floorPlanPage}`
        drawFloorPlanAtRotation(floorPlanRotation)
        onFloorPlanReady?.()
      }
      img.onload = () => onReady(img)
      img.onerror = () => {
        const img2 = new Image()
        img2.onload = () => onReady(img2)
        img2.src = floorPlanUrl
      }
      img.src = floorPlanUrl
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorPlanUrl, floorPlanPage])

  // Redraw (no reload) whenever just the rotation changes
  useEffect(() => {
    if (loadedUrlRef.current === `${floorPlanUrl}#${floorPlanPage}` && loadedSourceRef.current) {
      drawFloorPlanAtRotation(floorPlanRotation)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorPlanRotation])

  // Blend between red (weak) -> yellow (mid) -> green (strong) based on
  // a 0-1 normalized signal strength value.
  function heatColor(strength) {
    const s = Math.max(0, Math.min(1, strength))
    const green = [0, 180, 80], yellow = [255, 200, 0], red = [255, 50, 0]
    let c0, c1, t
    if (s >= 0.5) { c0 = yellow; c1 = green; t = (s - 0.5) * 2 }
    else { c0 = red; c1 = yellow; t = s * 2 }
    return c0.map((v, i) => Math.round(v + (c1[i] - v) * t))
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [55, 138, 221]
  }

  // Heat map — modeled on the indoor log-distance path loss model used
  // in published LoRaWAN propagation research: signal strength falls
  // off quickly near the source with a long weakening tail, rather
  // than a straight linear fade, and the rate of that falloff depends
  // on the environment's path-loss exponent (~1.8 for open floor
  // plans, up to ~3.0+ for heavily obstructed spaces like concrete/
  // CMU or hospitals). The user-specified range stays the anchor for
  // where coverage ends — the environment setting controls how
  // gracefully (or abruptly) signal degrades within that range.
  useEffect(() => {
    if (!hmCanvasRef.current || !wrapRef.current) return
    const canvas = hmCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!showHeatmap) { ctx.clearRect(0, 0, canvas.width, canvas.height); return }
    const wr = wrapRef.current.getBoundingClientRect()
    const W = wr.width, H = wr.height
    canvas.width = W; canvas.height = H
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
    ctx.clearRect(0, 0, W, H)
    const gws = devices.filter(d => d.dtype === 'rak-gw')
    if (!gws.length) return
    const rings = [] // collected so we can draw crisp (unblurred) boundary rings after

    // Draw the blurred fill directly on the real, on-page canvas rather
    // than routing through offscreen canvases — blur/filter support on
    // *detached* canvases (created but never attached to the page) has
    // a real history of being unreliable across browsers and can
    // silently produce a blank result even though the draw calls
    // themselves complete without error.
    ctx.save()
    ctx.filter = 'blur(10px)'
    gws.forEach(gw => {
      const cx = (gw.x + 19) * zoom + pan.x
      const cy = (gw.y + 19) * zoom + pan.y
      const r = Math.round((gw.hmRangeFt || 150) * pxPerFt * zoom)
      if (r <= 0) return
      const strengthSetting = gw.hmStrength ?? 1
      // Path-loss exponent from the chosen environment (see comment above).
      const n = 1.8 + (1 - strengthSetting) * 2.4
      const fillRgb = gw.hmFillColor ? hexToRgb(gw.hmFillColor) : null

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      const STOPS = 14
      for (let i = 0; i <= STOPS; i++) {
        const frac = i / STOPS
        // Inverse-power falloff, log-distance-path-loss-inspired: a
        // higher exponent drains signal faster within the same
        // specified range, matching how obstructed environments
        // behave less gracefully than open ones even at equal range.
        const strength = Math.pow(0.04 / (0.04 + frac), n)
        // A custom fill color, if set, replaces the auto green/yellow/
        // red interpolation — only opacity still varies with distance,
        // giving a single-color "area of coverage" fill instead.
        const [rr, gg, bb] = fillRgb || heatColor(Math.min(1, strength))
        const alpha = heatmapOpacity * Math.min(1, strength * 1.6 + 0.25)
        grad.addColorStop(frac, `rgba(${rr},${gg},${bb},${alpha})`)
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = grad; ctx.fill()
      rings.push({ cx, cy, r, rangeFt: gw.hmRangeFt || 150 })
    })
    ctx.restore() // clears the blur filter for what follows

    // Coverage boundary — a crisp (unblurred) ring at the specified
    // range for each gateway, so "area of coverage" is a clear,
    // readable line rather than just a fade with no defined edge.
    rings.forEach(({ cx, cy, r }) => {
      ctx.save()
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = 'rgba(40,40,40,0.55)'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    })
  }, [devices, showHeatmap, pxPerFt, zoom, pan, heatmapOpacity])

  // Restore SVG markup on mount only
  useEffect(() => {
    if (drawSvgRef.current && svgMarkup !== undefined) {
      drawSvgRef.current.innerHTML = svgMarkup
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const getSVGMarkup = useCallback(() => {
    return drawSvgRef.current ? drawSvgRef.current.innerHTML : ''
  }, [])

  function toCanvas(screenX, screenY) {
    const rect = wrapRef.current.getBoundingClientRect()
    return {
      x: (screenX - rect.left - panRef.current.x) / zoomRef.current,
      y: (screenY - rect.top - panRef.current.y) / zoomRef.current,
    }
  }

  // Attach wheel listener as non-passive so preventDefault works
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()

      // Pinch-to-zoom (trackpad) and Ctrl/Cmd+scroll (mouse) => zoom.
      // Plain two-finger scroll => pan. Without this split, every
      // ordinary scroll event was being read as a zoom command, and
      // trackpad momentum kept firing events after the gesture ended,
      // which is what produced the runaway "infinite zoom" and made
      // the floor plan feel like it never held still.
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        // Clamp the per-event delta so a big inertial spike can't
        // slam the zoom level in one jump. The exponent here is
        // deliberately gentle: trackpad pinch-to-zoom fires many
        // wheel events per second with fairly large deltaY values,
        // and a too-strong per-event multiplier compounds across
        // those events into the zoom level rocketing to its min/max
        // clamp almost instantly — which is what felt like
        // "crazy infinite zoom" even though it's just a very
        // oversensitive response to a normal gesture.
        const delta = Math.max(-25, Math.min(25, e.deltaY))
        const factor = Math.exp(-delta * 0.0015)
        // Floor plan is locked to its fitted size — never zoom below
        // that base ("fit to window") level, only in from there.
        const base = baseZoomRef.current || 1
        const newZoom = Math.min(Math.max(zoomRef.current * factor, base), 8)
        const newPan = newZoom === base
          ? getCenterOffset(newZoom)
          : {
              x: mouseX - (mouseX - panRef.current.x) * (newZoom / zoomRef.current),
              y: mouseY - (mouseY - panRef.current.y) * (newZoom / zoomRef.current),
            }
        zoomRef.current = newZoom
        panRef.current = newPan
        setZoom(newZoom)
        setPan(newPan)
      } else {
        // While at the locked "fit to window" baseline, the floor plan
        // shouldn't drift on plain scroll — panning only kicks in once
        // the user has actually zoomed in past the locked size.
        if (zoomRef.current <= (baseZoomRef.current || 1) + 0.001) return
        const newPan = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        }
        panRef.current = newPan
        setPan(newPan)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function handleWrapMouseDown(e) {
    if (e.target.closest('.sv-device')) return

    // Read-only (shared link) view — allow panning/zooming to look
    // around, but no drawing of any kind.
    if (readOnly && mode !== 'select') return

    // Calibration mode — click and drag a line across a known distance
    if (calibrating && e.button === 0) {
      const { x, y } = toCanvas(e.clientX, e.clientY)
      isCalibratingDrag.current = true
      calibStartRef.current = { x, y }
      setCalibDrag({ x1: x, y1: y, x2: x, y2: y })
      return
    }

    // Measure mode — click and drag a line to read its length in feet
    if (measuring && e.button === 0) {
      const { x, y } = toCanvas(e.clientX, e.clientY)
      isMeasuringDrag.current = true
      measureStartRef.current = { x, y }
      setMeasureLine({ x1: x, y1: y, x2: x, y2: y, distFt: 0 })
      return
    }

    // Click-and-hold to pan: middle-click or Alt+click always pans.
    // In select mode (the grab-hand cursor), a plain left-click-and-hold
    // on empty canvas also pans — mouseup below decides whether it ended
    // up being a real drag (pan) or just a click (deselect).
    const wantsPan = e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && mode === 'select')
    if (wantsPan) {
      e.preventDefault()
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY }
      panOrigin.current = { ...panRef.current }
      return
    }
    const { x, y } = toCanvas(e.clientX, e.clientY)
    if (mode === 'cable') {
      if (!drawingCable) setDrawingCable({ x1: x, y1: y, fromId: null, type: activeCableType })
      else finishCable(x, y, null)
      return
    }
    if (mode === 'label') {
      const t = prompt('Enter label:')
      if (t && drawSvgRef.current) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        el.setAttribute('x', x); el.setAttribute('y', y)
        el.setAttribute('fill', '#1a1a18')
        el.setAttribute('font-size', String(13 / zoomRef.current))
        el.setAttribute('font-family', 'system-ui'); el.textContent = t
        drawSvgRef.current.appendChild(el)
        onMarkupChange(getSVGMarkup())
      }
      return
    }
    if (mode === 'redline' || mode === 'wall') {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      el.setAttribute('x1', x); el.setAttribute('y1', y); el.setAttribute('x2', x); el.setAttribute('y2', y)
      el.setAttribute('stroke', mode === 'redline' ? '#E24B4A' : '#2C2C2A')
      el.setAttribute('stroke-width', String((mode === 'redline' ? 2.5 : 3) / zoomRef.current))
      el.setAttribute('stroke-linecap', 'round')
      drawSvgRef.current.appendChild(el)
      setDrawStart({ x, y }); setDrawEl(el); return
    }
    if (mode === 'room') {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', '0'); el.setAttribute('height', '0')
      el.setAttribute('fill', '#378ADD08'); el.setAttribute('stroke', '#378ADD')
      el.setAttribute('stroke-width', String(1.5 / zoomRef.current)); el.setAttribute('rx', '3')
      drawSvgRef.current.appendChild(el)
      setDrawStart({ x, y }); setDrawEl(el)
    }
  }

  function handleWrapMouseMove(e) {
    if (isCalibratingDrag.current) {
      const { x, y } = toCanvas(e.clientX, e.clientY)
      setCalibDrag({ x1: calibStartRef.current.x, y1: calibStartRef.current.y, x2: x, y2: y })
      return
    }
    if (isMeasuringDrag.current) {
      const { x, y } = toCanvas(e.clientX, e.clientY)
      const start = measureStartRef.current
      const dx = x - start.x, dy = y - start.y
      const pixelDist = Math.sqrt(dx * dx + dy * dy)
      const distFt = pxPerFt > 0 ? pixelDist / pxPerFt : 0
      setMeasureLine({ x1: start.x, y1: start.y, x2: x, y2: y, distFt })
      return
    }
    if (isPanning.current) {
      // Locked at the fitted "fit to window" baseline — dragging
      // shouldn't move the floor plan until the user has zoomed in.
      if (zoomRef.current <= (baseZoomRef.current || 1) + 0.001) return
      const newPan = {
        x: panOrigin.current.x + (e.clientX - panStart.current.x),
        y: panOrigin.current.y + (e.clientY - panStart.current.y),
      }
      panRef.current = newPan
      setPan(newPan)
      return
    }
    const { x, y } = toCanvas(e.clientX, e.clientY)
    if (mode === 'cable' && drawingCable) {
      setTempLine({ x1: drawingCable.x1, y1: drawingCable.y1, x2: x, y2: y, type: drawingCable.type })
    }
    if (drawStart && drawEl) {
      if (mode === 'wall' || mode === 'redline') {
        drawEl.setAttribute('x2', x); drawEl.setAttribute('y2', y)
      } else if (mode === 'room') {
        drawEl.setAttribute('x', Math.min(drawStart.x, x)); drawEl.setAttribute('y', Math.min(drawStart.y, y))
        drawEl.setAttribute('width', Math.abs(x - drawStart.x)); drawEl.setAttribute('height', Math.abs(y - drawStart.y))
      }
    }
  }

  function handleWrapMouseUp(e) {
    if (isMeasuringDrag.current) {
      isMeasuringDrag.current = false
      // Leave the line + reading on screen so it can actually be read;
      // it clears on the next drag or when the tool is switched off.
      return
    }
    if (isCalibratingDrag.current) {
      isCalibratingDrag.current = false
      const start = calibStartRef.current
      const { x, y } = toCanvas(e.clientX, e.clientY)
      setCalibDrag(null)
      if (onCalibrateDrag) onCalibrateDrag(start.x, start.y, x, y)
      return
    }
    if (isPanning.current) {
      isPanning.current = false
      // In select mode, a click-and-hold that never actually moved is
      // just a click on empty space — deselect, same as before. If it
      // moved, it was a real pan drag, so leave the current selection
      // (if any) alone.
      if (mode === 'select') {
        const dx = e.clientX - panStart.current.x
        const dy = e.clientY - panStart.current.y
        if (Math.hypot(dx, dy) < 4) {
          onDeviceSelect(null)
          onCableSelect(null)
        }
      }
      return
    }
    if (drawEl) { setDrawStart(null); setDrawEl(null); onMarkupChange(getSVGMarkup()) }
  }

  function finishCable(x2, y2, toId) {
    setTempLine(null)
    onCableAdd({ x1: drawingCable.x1, y1: drawingCable.y1, x2, y2, fromId: drawingCable.fromId, toId, type: drawingCable.type || 'cat6', label: '' })
    setDrawingCable(null)
  }

  function handleDeviceMouseDown(e, device) {
    e.stopPropagation()
    if (mode === 'cable') {
      const cx = device.x + 19, cy = device.y + 19
      if (!drawingCable) setDrawingCable({ x1: cx, y1: cy, fromId: device.id, type: activeCableType })
      else finishCable(cx, cy, device.id)
      return
    }
    if (mode !== 'select') return
    onDeviceSelect(device.id)
    if (readOnly) return
    const rect = wrapRef.current.getBoundingClientRect()
    const startX = (e.clientX - rect.left - panRef.current.x) / zoomRef.current - device.x
    const startY = (e.clientY - rect.top - panRef.current.y) / zoomRef.current - device.y
    function onMove(mv) {
      const x = (mv.clientX - rect.left - panRef.current.x) / zoomRef.current - startX
      const y = (mv.clientY - rect.top - panRef.current.y) / zoomRef.current - startY
      onDeviceMove(device.id, x, y)
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  function handleDrop(e) {
    e.preventDefault()
    const raw = e.dataTransfer.getData('app/device')
    if (!raw) return
    const data = JSON.parse(raw)
    const { x, y } = toCanvas(e.clientX, e.clientY)
    onDeviceAdd({ ...data, x: x - 19, y: y - 19, hmRangeFt: 120, hmStrength: 0.75 })
  }

  function zoomIn() {
    const newZoom = Math.min(zoomRef.current * 1.25, 8)
    const wr = wrapRef.current.getBoundingClientRect()
    const cx = wr.width / 2, cy = wr.height / 2
    const newPan = {
      x: cx - (cx - panRef.current.x) * (newZoom / zoomRef.current),
      y: cy - (cy - panRef.current.y) * (newZoom / zoomRef.current),
    }
    zoomRef.current = newZoom; panRef.current = newPan
    setZoom(newZoom); setPan(newPan)
  }

  function getBaseZoom() {
    const canvas = fpCanvasRef.current
    if (!canvas || !wrapRef.current) return 1
    const wr = wrapRef.current.getBoundingClientRect()
    const cw = parseFloat(canvas.style.width) || 0
    const ch = parseFloat(canvas.style.height) || 0
    if (!cw || !ch) return 1
    return Math.min(wr.width / cw, wr.height / ch, 1)
  }

  function getCenterOffset(zoomLevel) {
    const canvas = fpCanvasRef.current
    if (!canvas || !wrapRef.current) return { x: 0, y: 0 }
    const wr = wrapRef.current.getBoundingClientRect()
    const z = zoomLevel ?? zoomRef.current
    const cw = (parseFloat(canvas.style.width) || 0) * z
    const ch = (parseFloat(canvas.style.height) || 0) * z
    return { x: Math.max(0, (wr.width - cw) / 2), y: Math.max(0, (wr.height - ch) / 2) }
  }

  function zoomOut() {
    const base = baseZoomRef.current || 1
    const newZoom = Math.max(zoomRef.current * 0.8, base)
    const wr = wrapRef.current.getBoundingClientRect()
    const cx = wr.width / 2, cy = wr.height / 2
    const newPan = newZoom === base
      ? getCenterOffset(newZoom)
      : {
          x: cx - (cx - panRef.current.x) * (newZoom / zoomRef.current),
          y: cy - (cy - panRef.current.y) * (newZoom / zoomRef.current),
        }
    zoomRef.current = newZoom; panRef.current = newPan
    setZoom(newZoom); setPan(newPan)
  }

  function resetView() {
    const base = baseZoomRef.current || getBaseZoom()
    const centered = getCenterOffset(base)
    zoomRef.current = base; panRef.current = centered
    setZoom(base); setPan(centered)
  }

  function getSizeForDevice(dtype) {
    if (['reolink-fe','cam-dome','cam-bullet'].includes(dtype)) return iconSizes.cameras || 16
    if (['rak-gw','rak-node'].includes(dtype)) return iconSizes.lora || 20
    if (['mdf','idf','switch','ap','nvr','sage-equip'].includes(dtype)) return iconSizes.network || 20
    if (['reader','intercom'].includes(dtype)) return iconSizes.access || 16
    return 16
  }

  // Label font size is fully independent of icon size — previously it
  // was derived as a multiple of icon size, which meant shrinking the
  // icon (e.g. to fit a small imported floor plan) also shrank the
  // label, and below a certain icon size the label disappeared
  // entirely rather than just getting smaller.
  function getLabelSizeForDevice(dtype) {
    if (['reolink-fe','cam-dome','cam-bullet'].includes(dtype)) return labelSizes.cameras || 10
    if (['rak-gw','rak-node'].includes(dtype)) return labelSizes.lora || 13
    if (['mdf','idf','switch','ap','nvr','sage-equip'].includes(dtype)) return labelSizes.network || 10
    if (['reader','intercom'].includes(dtype)) return labelSizes.access || 10
    return 10
  }

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`

  return (
    <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button onClick={zoomIn} style={zoomBtn}>+</button>
        <button onClick={zoomOut} style={zoomBtn}>−</button>
        <button onClick={resetView} style={{ ...zoomBtn, fontSize: 11 }}>⌂</button>
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 10, fontSize: 10, color: '#888', background: 'rgba(255,255,255,0.85)', padding: '2px 7px', borderRadius: 4, pointerEvents: 'none' }}>
        {Math.round((zoom / (baseZoomRef.current || 1)) * 100)}% · {zoom > (baseZoomRef.current || 1) + 0.001 ? 'scroll or drag to pan · pinch / ⌘+scroll to zoom' : 'pinch / ⌘+scroll to zoom in'}
      </div>

      <div
        ref={wrapRef}
        style={{
          width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
          cursor: (calibrating || measuring) ? 'crosshair' : isPanning.current ? 'grabbing' : mode === 'select' ? 'grab' : 'crosshair',
          background: 'repeating-linear-gradient(0deg,transparent,transparent 29px,rgba(0,0,0,0.06) 30px),repeating-linear-gradient(90deg,transparent,transparent 29px,rgba(0,0,0,0.06) 30px)'
        }}
        data-export-canvas="true"
        onMouseDown={handleWrapMouseDown}
        onMouseMove={handleWrapMouseMove}
        onMouseUp={e => handleWrapMouseUp(e)}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Zoomable layer */}
        <div style={{ position: 'absolute', top: 0, left: 0, transform, transformOrigin: '0 0', willChange: 'transform' }}>
          <canvas ref={fpCanvasRef} style={{ position: 'absolute', top: 0, left: 0, opacity: 0.85, pointerEvents: 'none' }} />

          {/* Cables — fully React-rendered from state */}
          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
            {cables.map(c => {
              const cs = CABLE_STYLES[c.type] || CABLE_STYLES.cat6
              const sw = cs.width / zoom
              return (
                <g key={c.id}>
                  <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={cs.stroke} strokeWidth={sw} strokeDasharray={cs.dash || undefined} />
                  <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="transparent" strokeWidth={12 / zoom}
                    style={{ cursor: 'pointer', pointerEvents: 'all' }} onClick={() => onCableSelect(c.id)} />
                  {selectedCableId === c.id && <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={cs.stroke} strokeWidth={sw + 2 / zoom} opacity="0.4" strokeDasharray={cs.dash || undefined} />}
                  {c.label && <text x={(c.x1 + c.x2) / 2} y={(c.y1 + c.y2) / 2 - 6 / zoom} textAnchor="middle" fontSize={11 / zoom} fill="#444" fontFamily="system-ui">{c.label}</text>}
                </g>
              )
            })}
            {tempLine && (() => {
              const cs = CABLE_STYLES[tempLine.type] || CABLE_STYLES.cat6
              return <line x1={tempLine.x1} y1={tempLine.y1} x2={tempLine.x2} y2={tempLine.y2} stroke={cs.stroke} strokeWidth={cs.width / zoom} strokeDasharray={cs.dash || undefined} opacity="0.5" />
            })()}
          </svg>

          {/* Walls / rooms / labels / redlines — deliberately given ZERO
              children in JSX (and never given any) so React never
              reconciles this element's contents. All drawing happens
              imperatively via drawSvgRef (appendChild / innerHTML).
              Sharing this element with React-rendered content used to
              cause React to wipe out anything drawn here on the very
              next re-render — which happens on almost every mouse
              move — making walls/rooms/labels/redlines appear to draw
              successfully but never actually show up. */}
          <svg ref={drawSvgRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }} />

          {/* Cover patches for AI/color-detected devices — hides the
              original flattened marker pixels from the source PDF/image
              underneath the new editable device icon. Purely a visual
              overlay in this same pan/zoom layer; the underlying floor
              plan image itself is never modified, so this disappears
              automatically if the device it belongs to gets deleted.
              Sized directly off the icon's own render size (a value we
              already know looks right at any zoom/PDF) rather than the
              detected blob's measured pixels converted through the
              PDF's own point-scale — that math could produce a patch
              far bigger than intended depending on a given PDF's real
              point dimensions, which is what caused this to blanket
              large areas of some floor plans. */}
          {devices.filter(d => d.mask).map(d => {
            // AI detection can supply a tight per-marker bounding box
            // (capped upstream); color-based detection can't, so it
            // falls back to a size relative to the icon itself — a
            // value we already know renders sanely at any zoom/PDF.
            // Floored here too (not just at detection time) so an
            // already-saved device with a bad, near-zero stored value
            // self-heals on the next load instead of staying invisible
            // until re-detected.
            const iconFallback = getSizeForDevice(d.dtype) * 2
            // Bounded BOTH directions, entirely relative to the icon's
            // own render size — not an absolute unit value. Absolute
            // caps (e.g. "150 units") kept breaking because a given
            // number of "points" means a wildly different real-world
            // size depending on each PDF's own page dimensions; tying
            // this purely to a value we already know renders correctly
            // (the icon size) sidesteps that entirely, on every PDF.
            const maskW = Math.min(Math.max(d.maskW || iconFallback, iconFallback * 0.6), iconFallback * 1.5)
            const maskH = Math.min(Math.max(d.maskH || iconFallback, iconFallback * 0.6), iconFallback * 1.5)
            return (
              <div key={'mask-' + d.id} style={{
                position: 'absolute',
                left: d.x + 19 - maskW / 2,
                top: d.y + 19 - maskH / 2,
                width: maskW, height: maskH,
                borderRadius: Math.min(maskW, maskH) / 2,
                background: '#fdfdfb',
                boxShadow: '0 0 3px 1px #fdfdfbdd',
                pointerEvents: 'none',
              }} />
            )
          })}

          {devices.map(d => (
            <div key={d.id} className="sv-device" onMouseDown={e => handleDeviceMouseDown(e, d)}
              onDoubleClick={e => {
                // Renaming normally happens via double-clicking the
                // label text itself — but if this device type's labels
                // are hidden, there's no label to double-click, so the
                // whole device (icon included) picks up the same
                // rename action as a fallback.
                if (!hiddenLabelTypes.includes(d.dtype)) return
                e.stopPropagation()
                if (readOnly) return
                const newLabel = prompt('Rename device:', d.label)
                if (newLabel !== null && newLabel.trim()) onDeviceMove(d.id, d.x, d.y, newLabel.trim())
              }}
              style={{ position: 'absolute', left: d.x, top: d.y, cursor: mode === 'select' ? 'move' : 'pointer', userSelect: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              {(() => {
                // Detected devices render smaller while awaiting review
                // — the dashed amber outline + badge already flag them
                // as "needs review," and full-size renders as a fairly
                // busy shape at this scale (the RAK Gateway icon in
                // particular is a dense 8-petal flower). Confirming a
                // device drops `unconfirmed`, so it snaps back to the
                // survey's normal icon size immediately.
                const sz = getSizeForDevice(d.dtype) * (d.unconfirmed ? 0.55 : 1)
                const status = d.status || 'existing'
                const statusInfo = DEVICE_STATUSES[status] || DEVICE_STATUSES.existing
                const isProposed = status === 'proposed'
                const isRemoved = status === 'removed'
                const borderWidth = Math.max(1, Math.round(sz * 0.06))
                return (
                  <>
                    <div style={{
                      position: 'relative',
                      width: sz, height: sz, borderRadius: Math.round(sz * 0.25), display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: sz > 8 ? d.color + '15' : 'transparent',
                      opacity: isRemoved ? 0.45 : 1,
                      border: d.unconfirmed
                        ? `${Math.max(borderWidth, 2)}px dashed #BA7517`
                        : selectedId === d.id
                          ? `${borderWidth}px solid ${d.color}`
                          : `${borderWidth}px ${isProposed ? 'dashed' : 'solid'} ${isProposed ? statusInfo.color + '99' : 'transparent'}`,
                      boxShadow: d.unconfirmed ? '0 0 0 3px #F0D48866' : (selectedId === d.id ? `0 0 0 2px ${d.color}33` : 'none')
                    }}>
                      <svg width={sz} height={sz} viewBox="0 0 34 34" dangerouslySetInnerHTML={{ __html: getIconPaths(d.dtype, d.color) }} />
                      {isRemoved && (
                        <div style={{ position: 'absolute', left: '10%', top: '48%', width: '80%', height: Math.max(1, Math.round(sz * 0.06)), background: statusInfo.color, transform: 'rotate(-15deg)' }} />
                      )}
                      {d.unconfirmed && (
                        <div title="Detected automatically — needs review" style={{ position: 'absolute', top: -3, left: -3, width: Math.max(10, Math.round(sz * 0.35)), height: Math.max(10, Math.round(sz * 0.35)), borderRadius: '50%', background: '#BA7517', border: '1px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <i className="ti ti-scan" style={{ fontSize: Math.max(6, Math.round(sz * 0.2)), color: '#fff' }} />
                        </div>
                      )}
                      {d.photoUrl && sz >= 12 && (
                        <div style={{ position: 'absolute', top: -3, right: -3, width: Math.max(10, Math.round(sz * 0.35)), height: Math.max(10, Math.round(sz * 0.35)), borderRadius: '50%', background: '#378ADD', border: '1px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <i className="ti ti-camera" style={{ fontSize: Math.max(6, Math.round(sz * 0.22)), color: '#fff' }} />
                        </div>
                      )}
                    </div>
                    {!hiddenLabelTypes.includes(d.dtype) && (
                      <div
                        title="Double-click to rename"
                        onDoubleClick={e => {
                          e.stopPropagation()
                          if (readOnly) return
                          const newLabel = prompt('Rename device:', d.label)
                          if (newLabel !== null && newLabel.trim()) onDeviceMove(d.id, d.x, d.y, newLabel.trim())
                        }}
                        style={{ fontSize: getLabelSizeForDevice(d.dtype), color: '#1a1a18', background: 'rgba(255,255,255,0.92)', padding: '1px 4px', borderRadius: 3, border: '0.5px solid #ddd', whiteSpace: 'nowrap', cursor: readOnly ? 'default' : 'text' }}>
                        {d.label}
                        {isProposed && <span style={{ color: statusInfo.color, marginLeft: 3 }}>•</span>}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          ))}
        </div>

        {/* Calibration overlay — live line while dragging */}
        {calibDrag && (
          <div style={{ position: 'absolute', top: 0, left: 0, transform, transformOrigin: '0 0', pointerEvents: 'none', zIndex: 20 }}>
            <svg style={{ overflow: 'visible', position: 'absolute', top: 0, left: 0 }}>
              <circle cx={calibDrag.x1} cy={calibDrag.y1} r={6 / zoom} fill="#E24B4A" stroke="#fff" strokeWidth={2 / zoom} />
              <line x1={calibDrag.x1} y1={calibDrag.y1} x2={calibDrag.x2} y2={calibDrag.y2}
                stroke="#E24B4A" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom},${4 / zoom}`} />
              <circle cx={calibDrag.x2} cy={calibDrag.y2} r={6 / zoom} fill="#E24B4A" stroke="#fff" strokeWidth={2 / zoom} />
            </svg>
          </div>
        )}

        {/* Measurement overlay — line + live distance reading, stays
            visible after mouseup so it can actually be read */}
        {measureLine && (
          <div style={{ position: 'absolute', top: 0, left: 0, transform, transformOrigin: '0 0', pointerEvents: 'none', zIndex: 20 }}>
            <svg style={{ overflow: 'visible', position: 'absolute', top: 0, left: 0 }}>
              <circle cx={measureLine.x1} cy={measureLine.y1} r={6 / zoom} fill="#378ADD" stroke="#fff" strokeWidth={2 / zoom} />
              <line x1={measureLine.x1} y1={measureLine.y1} x2={measureLine.x2} y2={measureLine.y2}
                stroke="#378ADD" strokeWidth={2.5 / zoom} strokeDasharray={`${6 / zoom},${4 / zoom}`} />
              <circle cx={measureLine.x2} cy={measureLine.y2} r={6 / zoom} fill="#378ADD" stroke="#fff" strokeWidth={2 / zoom} />
            </svg>
            <div style={{
              position: 'absolute',
              left: (measureLine.x1 + measureLine.x2) / 2,
              top: (measureLine.y1 + measureLine.y2) / 2,
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
              transformOrigin: 'center',
              background: '#378ADD', color: '#fff', fontSize: 12, fontWeight: 600,
              padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap', boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
            }}>
              {measureLine.distFt.toFixed(1)} ft
            </div>
          </div>
        )}

        {/* Heat map outside zoom layer - always fills viewport */}
        <canvas ref={hmCanvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', opacity: 1 }} />
      </div>
    </div>
  )
})

export default SurveyCanvas

const zoomBtn = {
  width: 28, height: 28, background: 'rgba(255,255,255,0.92)', border: '0.5px solid #ccc',
  borderRadius: 6, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontWeight: 400, color: '#333', lineHeight: 1
}

import { useRef, useEffect, useState, useCallback } from 'react'
import { getIconPaths, CABLE_STYLES } from '../lib/devices'

export default function SurveyCanvas({
  devices, cables, svgMarkup, pxPerFt, showHeatmap,
  mode, activeCableType,
  onDeviceAdd, onDeviceMove, onDeviceSelect,
  onCableAdd, onCableSelect,
  onMarkupChange,
  selectedId, selectedCableId,
  floorPlanUrl,
  floorPlanRotation = 0,
}) {
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
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const panOrigin = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })

  // Keep refs in sync for event handlers
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  // Load / clear floor plan
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
          const page = await pdf.getPage(1)
          const RENDER_SCALE = 3
          const vp = page.getViewport({ scale: RENDER_SCALE })
          canvas.width = Math.round(vp.width)
          canvas.height = Math.round(vp.height)
          const wr = wrapRef.current.getBoundingClientRect()
          const displayScale = Math.min(wr.width / canvas.width, wr.height / canvas.height)
          canvas.style.width = Math.round(canvas.width * displayScale) + 'px'
          canvas.style.height = Math.round(canvas.height * displayScale) + 'px'
          await page.render({ canvasContext: ctx, viewport: vp }).promise
          // Apply rotation if needed
          const rot = floorPlanRotation || 0
          if (rot !== 0) {
            const isRotated90 = rot === 90 || rot === 270
            const offscreen = document.createElement('canvas')
            offscreen.width = isRotated90 ? canvas.height : canvas.width
            offscreen.height = isRotated90 ? canvas.width : canvas.height
            const octx = offscreen.getContext('2d')
            octx.translate(offscreen.width / 2, offscreen.height / 2)
            octx.rotate((rot * Math.PI) / 180)
            octx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
            canvas.width = offscreen.width
            canvas.height = offscreen.height
            canvas.style.width = Math.round(canvas.width * displayScale) + 'px'
            canvas.style.height = Math.round(canvas.height * displayScale) + 'px'
            ctx.drawImage(offscreen, 0, 0)
          }
        } catch (err) { console.error('PDF render error:', err) }
      }
      loadPDF()
    } else {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      const draw = (image) => {
        const wr = wrapRef.current.getBoundingClientRect()
        const rot = floorPlanRotation || 0
        const isRotated90 = rot === 90 || rot === 270
        const srcW = image.naturalWidth, srcH = image.naturalHeight
        const displayW = isRotated90 ? srcH : srcW
        const displayH = isRotated90 ? srcW : srcH
        const scale = Math.min(wr.width / displayW, wr.height / displayH, 1) * 2
        canvas.width = Math.round(displayW * scale)
        canvas.height = Math.round(displayH * scale)
        canvas.style.width = Math.round(canvas.width / 2) + 'px'
        canvas.style.height = Math.round(canvas.height / 2) + 'px'
        const rad = (rot * Math.PI) / 180
        ctx.save()
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate(rad)
        ctx.drawImage(image, -srcW * scale / 2, -srcH * scale / 2, srcW * scale, srcH * scale)
        ctx.restore()
      }
      img.onload = () => draw(img)
      img.onerror = () => {
        const img2 = new Image()
        img2.onload = () => draw(img2)
        img2.src = floorPlanUrl
      }
      img.src = floorPlanUrl
    }
}, [floorPlanUrl, floorPlanRotation])

  // Heat map
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
    const off = document.createElement('canvas')
    off.width = W; off.height = H
    const octx = off.getContext('2d')
    gws.forEach(gw => {
      const cx = (gw.x + 19) * zoom + pan.x
      const cy = (gw.y + 19) * zoom + pan.y
      const r = Math.round((gw.hmRangeFt || 150) * pxPerFt * zoom)
      const strength = gw.hmStrength || 1
      for (let i = 7; i >= 1; i--) {
        const frac = i / 7
        const radius = r * frac
        const alpha = strength * (1 - frac + 0.1) * 0.4
        let fill
        if (frac < 0.33) fill = `rgba(255,50,0,${alpha})`
        else if (frac < 0.66) fill = `rgba(255,200,0,${alpha})`
        else fill = `rgba(0,180,80,${alpha})`
        octx.beginPath(); octx.arc(cx, cy, radius, 0, Math.PI * 2)
        octx.fillStyle = fill; octx.fill()
      }
    })
    const blur = document.createElement('canvas')
    blur.width = W; blur.height = H
    const bctx = blur.getContext('2d')
    bctx.filter = 'blur(28px)'
    bctx.drawImage(off, 0, 0)
    ctx.drawImage(blur, 0, 0)
  }, [devices, showHeatmap, pxPerFt, zoom, pan])

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
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.min(Math.max(zoomRef.current * factor, 0.2), 8)
      const newPan = {
        x: mouseX - (mouseX - panRef.current.x) * (newZoom / zoomRef.current),
        y: mouseY - (mouseY - panRef.current.y) * (newZoom / zoomRef.current),
      }
      zoomRef.current = newZoom
      panRef.current = newPan
      setZoom(newZoom)
      setPan(newPan)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function handleWrapMouseDown(e) {
    if (e.target.closest('.sv-device')) return
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
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
    if (mode === 'select') { onDeviceSelect(null); onCableSelect(null); return }
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
    if (isPanning.current) {
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

  function handleWrapMouseUp() {
    if (isPanning.current) { isPanning.current = false; return }
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
    onDeviceAdd({ ...data, x: x - 19, y: y - 19, hmRangeFt: 150, hmStrength: 1 })
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

  function zoomOut() {
    const newZoom = Math.max(zoomRef.current * 0.8, 0.2)
    const wr = wrapRef.current.getBoundingClientRect()
    const cx = wr.width / 2, cy = wr.height / 2
    const newPan = {
      x: cx - (cx - panRef.current.x) * (newZoom / zoomRef.current),
      y: cy - (cy - panRef.current.y) * (newZoom / zoomRef.current),
    }
    zoomRef.current = newZoom; panRef.current = newPan
    setZoom(newZoom); setPan(newPan)
  }

  function resetView() {
    zoomRef.current = 1; panRef.current = { x: 0, y: 0 }
    setZoom(1); setPan({ x: 0, y: 0 })
  }

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button onClick={zoomIn} style={zoomBtn}>+</button>
        <button onClick={zoomOut} style={zoomBtn}>−</button>
        <button onClick={resetView} style={{ ...zoomBtn, fontSize: 11 }}>⌂</button>
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 10, fontSize: 10, color: '#888', background: 'rgba(255,255,255,0.85)', padding: '2px 7px', borderRadius: 4, pointerEvents: 'none' }}>
        {Math.round(zoom * 100)}% · scroll to zoom · alt+drag to pan
      </div>

      <div
        ref={wrapRef}
        style={{
          width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
          cursor: isPanning.current ? 'grabbing' : mode === 'select' ? 'default' : 'crosshair',
          background: 'repeating-linear-gradient(0deg,transparent,transparent 29px,rgba(0,0,0,0.06) 30px),repeating-linear-gradient(90deg,transparent,transparent 29px,rgba(0,0,0,0.06) 30px)'
        }}
        onMouseDown={handleWrapMouseDown}
        onMouseMove={handleWrapMouseMove}
        onMouseUp={handleWrapMouseUp}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Zoomable layer */}
        <div style={{ position: 'absolute', top: 0, left: 0, transform, transformOrigin: '0 0', willChange: 'transform' }}>
          <canvas ref={fpCanvasRef} style={{ position: 'absolute', top: 0, left: 0, opacity: 0.85, pointerEvents: 'none' }} />

          <svg ref={drawSvgRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
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

          {devices.map(d => (
            <div key={d.id} className="sv-device" onMouseDown={e => handleDeviceMouseDown(e, d)}
              style={{ position: 'absolute', left: d.x, top: d.y, cursor: mode === 'select' ? 'move' : 'pointer', userSelect: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: d.color + '15', border: selectedId === d.id ? `2px solid ${d.color}` : '2px solid transparent',
                boxShadow: selectedId === d.id ? `0 0 0 3px ${d.color}22` : 'none'
              }}>
                <svg width="34" height="34" viewBox="0 0 34 34" dangerouslySetInnerHTML={{ __html: getIconPaths(d.dtype, d.color) }} />
              </div>
              <div style={{ fontSize: 10, color: '#1a1a18', background: 'rgba(255,255,255,0.92)', padding: '1px 5px', borderRadius: 4, border: '0.5px solid #ddd', whiteSpace: 'nowrap', maxWidth: 84, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.label}
              </div>
            </div>
          ))}
        </div>

        {/* Heat map outside zoom layer - always fills viewport */}
        <canvas ref={hmCanvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', opacity: 0.85 }} />
      </div>
    </div>
  )
}

const zoomBtn = {
  width: 28, height: 28, background: 'rgba(255,255,255,0.92)', border: '0.5px solid #ccc',
  borderRadius: 6, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontWeight: 400, color: '#333', lineHeight: 1
}

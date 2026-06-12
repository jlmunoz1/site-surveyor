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
}) {
  const wrapRef = useRef(null)
  const fpCanvasRef = useRef(null)
  const hmCanvasRef = useRef(null)
  const drawSvgRef = useRef(null)
  const [drawingCable, setDrawingCable] = useState(null)
  const [tempLine, setTempLine] = useState(null)
  const [drawStart, setDrawStart] = useState(null)
  const [drawEl, setDrawEl] = useState(null)

  // Load floor plan image/PDF URL
 useEffect(() => {
    if (!floorPlanUrl || !fpCanvasRef.current || !wrapRef.current) return
    const canvas = fpCanvasRef.current
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const wr = wrapRef.current.getBoundingClientRect()
      const scale = Math.min(wr.width / img.naturalWidth, wr.height / img.naturalHeight, 1)
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.style.width = canvas.width + 'px'
      canvas.style.height = canvas.height + 'px'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.onerror = () => {
      const proxyUrl = floorPlanUrl.replace('https://', 'https://images.weserv.nl/?url=')
      const img2 = new Image()
      img2.onload = () => {
        const wr = wrapRef.current.getBoundingClientRect()
        const scale = Math.min(wr.width / img2.naturalWidth, wr.height / img2.naturalHeight, 1)
        canvas.width = Math.round(img2.naturalWidth * scale)
        canvas.height = Math.round(img2.naturalHeight * scale)
        canvas.style.width = canvas.width + 'px'
        canvas.style.height = canvas.height + 'px'
        ctx.drawImage(img2, 0, 0, canvas.width, canvas.height)
      }
      img2.src = proxyUrl
    }
    img.src = floorPlanUrl
  }, [floorPlanUrl])
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const wr = wrapRef.current.getBoundingClientRect()
        const scale = Math.min(wr.width / img.naturalWidth, wr.height / img.naturalHeight, 1)
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        canvas.style.width = canvas.width + 'px'
        canvas.style.height = canvas.height + 'px'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      }
      img.src = floorPlanUrl
    }
  }, [floorPlanUrl])

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
      const cx = gw.x + 19, cy = gw.y + 19
      const r = Math.round((gw.hmRangeFt || 150) * pxPerFt)
      const strength = gw.hmStrength || 1
      for (let i = 7; i >= 1; i--) {
        const frac = i / 7
        const radius = r * frac
        const alpha = strength * (1 - frac + 0.1) * 0.4
        let fill
        if (frac < 0.35) fill = `rgba(255,${Math.round(50 + frac * 400)},0,${alpha})`
        else if (frac < 0.65) fill = `rgba(${Math.round(255 - (frac - 0.35) * 500)},210,0,${alpha})`
        else fill = `rgba(0,${Math.round(150 + frac * 70)},80,${alpha})`
        octx.beginPath(); octx.arc(cx, cy, radius, 0, Math.PI * 2)
        octx.fillStyle = fill; octx.fill()
      }
    })
    const blur = document.createElement('canvas')
    blur.width = W; blur.height = H
    const bctx = blur.getContext('2d')
    bctx.filter = 'blur(20px)'
    bctx.drawImage(off, 0, 0)
    ctx.drawImage(blur, 0, 0)
  }, [devices, showHeatmap, pxPerFt])

  // Restore SVG markup (redlines, walls, rooms, labels)
  useEffect(() => {
    if (drawSvgRef.current && svgMarkup !== undefined) {
      drawSvgRef.current.innerHTML = svgMarkup
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const getSVGMarkup = useCallback(() => {
    return drawSvgRef.current ? drawSvgRef.current.innerHTML : ''
  }, [])

  function getPos(e) {
    const rect = wrapRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handleWrapMouseDown(e) {
    if (e.target.closest('.sv-device')) return
    const { x, y } = getPos(e)

    if (mode === 'cable') {
      if (!drawingCable) {
        setDrawingCable({ x1: x, y1: y, fromId: null, type: activeCableType })
      } else {
        finishCable(x, y, null)
      }
      return
    }
    if (mode === 'select') {
      onDeviceSelect(null); onCableSelect(null); return
    }
    if (mode === 'label') {
      const t = prompt('Enter label:')
      if (t && drawSvgRef.current) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        el.setAttribute('x', x); el.setAttribute('y', y)
        el.setAttribute('fill', '#1a1a18'); el.setAttribute('font-size', '13')
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
      el.setAttribute('stroke-width', mode === 'redline' ? '2.5' : '3')
      el.setAttribute('stroke-linecap', 'round')
      drawSvgRef.current.appendChild(el)
      setDrawStart({ x, y }); setDrawEl(el)
      return
    }
    if (mode === 'room') {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', '0'); el.setAttribute('height', '0')
      el.setAttribute('fill', '#378ADD08'); el.setAttribute('stroke', '#378ADD')
      el.setAttribute('stroke-width', '1.5'); el.setAttribute('rx', '3')
      drawSvgRef.current.appendChild(el)
      setDrawStart({ x, y }); setDrawEl(el)
    }
  }

  function handleWrapMouseMove(e) {
    const { x, y } = getPos(e)
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
    const startX = e.clientX - device.x, startY = e.clientY - device.y
    function onMove(mv) { onDeviceMove(device.id, mv.clientX - startX, mv.clientY - startY) }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  function handleDrop(e) {
    e.preventDefault()
    const raw = e.dataTransfer.getData('app/device')
    if (!raw) return
    const data = JSON.parse(raw)
    const rect = wrapRef.current.getBoundingClientRect()
    onDeviceAdd({ ...data, x: e.clientX - rect.left - 19, y: e.clientY - rect.top - 19, hmRangeFt: 150, hmStrength: 1 })
  }

  const cursor = mode === 'select' ? 'default' : 'crosshair'

  return (
    <div
      ref={wrapRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor,
        background: 'repeating-linear-gradient(0deg,transparent,transparent 29px,rgba(0,0,0,0.06) 30px),repeating-linear-gradient(90deg,transparent,transparent 29px,rgba(0,0,0,0.06) 30px)'
      }}
      onMouseDown={handleWrapMouseDown}
      onMouseMove={handleWrapMouseMove}
      onMouseUp={handleWrapMouseUp}
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      <canvas ref={fpCanvasRef} style={{ position: 'absolute', top: 0, left: 0, opacity: 0.4, pointerEvents: 'none' }} />
      <canvas ref={hmCanvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />

      <svg ref={drawSvgRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {cables.map(c => {
          const cs = CABLE_STYLES[c.type] || CABLE_STYLES.cat6
          return (
            <g key={c.id}>
              <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={cs.stroke} strokeWidth={cs.width} strokeDasharray={cs.dash || undefined} />
              <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="transparent" strokeWidth="12" style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onClick={() => onCableSelect(c.id)} />
              {selectedCableId === c.id && <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={cs.stroke} strokeWidth={cs.width + 2} opacity="0.4" strokeDasharray={cs.dash || undefined} />}
              {c.label && <text x={(c.x1 + c.x2) / 2} y={(c.y1 + c.y2) / 2 - 6} textAnchor="middle" fontSize="11" fill="#444" fontFamily="system-ui">{c.label}</text>}
            </g>
          )
        })}
        {tempLine && (() => {
          const cs = CABLE_STYLES[tempLine.type] || CABLE_STYLES.cat6
          return <line x1={tempLine.x1} y1={tempLine.y1} x2={tempLine.x2} y2={tempLine.y2} stroke={cs.stroke} strokeWidth={cs.width} strokeDasharray={cs.dash || undefined} opacity="0.5" />
        })()}
      </svg>

      {devices.map(d => (
        <div
          key={d.id}
          className="sv-device"
          onMouseDown={e => handleDeviceMouseDown(e, d)}
          style={{ position: 'absolute', left: d.x, top: d.y, cursor: mode === 'select' ? 'move' : 'pointer', userSelect: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
        >
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
  )
}

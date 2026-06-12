import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSurvey, getSurveyByToken, saveSurvey, uploadFloorPlan, createShareToken } from '../lib/supabase'
import SurveyCanvas from '../components/SurveyCanvas'
import { DEVICE_DEFS, CABLE_STYLES, DeviceIcon } from '../lib/devices'
import { v4 as uuidv4 } from 'uuid'

export default function SurveyEditor() {
  const { id, token } = useParams()
  const navigate = useNavigate()
  const isShared = Boolean(token)

  const [survey, setSurvey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [error, setError] = useState('')

  const [devices, setDevices] = useState([])
  const [cables, setCables] = useState([])
  const [svgMarkup, setSvgMarkup] = useState('')
  const [pxPerFt, setPxPerFt] = useState(4)
  const [floorPlanUrl, setFloorPlanUrl] = useState('')
  const [floorPlanRotation, setFloorPlanRotation] = useState(0)
  const [iconSize, setIconSize] = useState(38)
  const [exportingPDF, setExportingPDF] = useState(false)

  const [mode, setMode] = useState(isShared ? 'redline' : 'select')
  const [activeCableType, setActiveCableType] = useState('cat6')
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [selectedCableId, setSelectedCableId] = useState(null)

  const [showShare, setShowShare] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [showScale, setShowScale] = useState(false)
  const [scaleInput, setScaleInput] = useState('4')
  const [showBOM, setShowBOM] = useState(false)

  const fileInputRef = useRef(null)
  const saveTimer = useRef(null)

  useEffect(() => {
    loadSurvey()
  }, [id, token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSurvey() {
    setLoading(true)
    const { data, error } = token ? await getSurveyByToken(token) : await getSurvey(id)
    if (error || !data) { setError('Survey not found.'); setLoading(false); return }
    setSurvey(data)
    setDevices(data.devices || [])
    setCables(data.cables || [])
    setSvgMarkup(data.svg_markup || '')
    setPxPerFt(data.px_per_ft || 4)
    setScaleInput(String(data.px_per_ft || 4))
    setFloorPlanUrl(data.floor_plan_url || '')
    setFloorPlanRotation(data.floor_plan_rotation || 0)
    setIconSize(data.icon_size || 38)
    setLoading(false)
  }

  const scheduleSave = useCallback((devs, cabs, markup, scale) => {
    if (isShared) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      await saveSurvey(id, { devices: devs, cables: cabs, svg_markup: markup, px_per_ft: scale })
      setSaving(false); setSaveMsg('Saved'); setTimeout(() => setSaveMsg(''), 2000)
    }, 1200)
  }, [id, isShared])

  function updateDevices(newDevs) { setDevices(newDevs); scheduleSave(newDevs, cables, svgMarkup, pxPerFt) }
  function updateCables(newCabs) { setCables(newCabs); scheduleSave(devices, newCabs, svgMarkup, pxPerFt) }
  function updateMarkup(m) { setSvgMarkup(m); scheduleSave(devices, cables, m, pxPerFt) }
  function updateScale(s) { setPxPerFt(s); scheduleSave(devices, cables, svgMarkup, s) }
  function updateIconSize(s) { setIconSize(s); saveSurvey(id, { icon_size: s }) }

  function handleDeviceAdd(data) {
    const d = { ...data, id: uuidv4(), model: '', ip: '', notes: '', cost: 0, qty: 1 }
    updateDevices([...devices, d])
    setSelectedId(d.id); setSelectedCableId(null)
  }
  function handleDeviceMove(devId, x, y) {
    setDevices(prev => {
      const n = prev.map(d => d.id === devId ? { ...d, x, y } : d)
      scheduleSave(n, cables, svgMarkup, pxPerFt)
      return n
    })
  }
  function handleDeviceSelect(devId) { setSelectedId(devId); setSelectedCableId(null) }
  function handleCableAdd(data) {
    const c = { ...data, id: uuidv4() }
    updateCables([...cables, c])
    setSelectedCableId(c.id); setSelectedId(null)
  }
  function handleCableSelect(cableId) { setSelectedCableId(cableId); setSelectedId(null) }

  const selectedDevice = devices.find(d => d.id === selectedId)
  const selectedCable = cables.find(c => c.id === selectedCableId)

  function updateSelectedDevice(field, value) {
    setDevices(prev => {
      const n = prev.map(d => d.id === selectedId ? { ...d, [field]: value } : d)
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
    setFloorPlanUrl(url)
    await saveSurvey(id, { floor_plan_url: url })
    setSaving(false); setSaveMsg('Floor plan uploaded'); setTimeout(() => setSaveMsg(''), 2500)
    e.target.value = ''
  }

  async function handleDeleteFloorPlan() {
    if (!window.confirm('Remove the floor plan from this survey?')) return
    setSaving(true)
    await saveSurvey(id, { floor_plan_url: '', floor_plan_rotation: 0 })
    setFloorPlanUrl('')
    setFloorPlanRotation(0)
    setSaving(false); setSaveMsg('Floor plan removed'); setTimeout(() => setSaveMsg(''), 2000)
  }

  async function handleRotateFloorPlan() {
    const newRotation = (floorPlanRotation + 90) % 360
    setFloorPlanRotation(newRotation)
    await saveSurvey(id, { floor_plan_rotation: newRotation })
  }

  async function handleExportPDF() {
    setExportingPDF(true)
    try {
      const jsPDFScript = document.createElement('script')
      jsPDFScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
      await new Promise((res, rej) => { jsPDFScript.onload = res; jsPDFScript.onerror = rej; document.head.appendChild(jsPDFScript) })
      const html2canvasScript = document.createElement('script')
      html2canvasScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
      await new Promise((res, rej) => { html2canvasScript.onload = res; html2canvasScript.onerror = rej; document.head.appendChild(html2canvasScript) })
      const canvasEl = document.querySelector('[data-export-canvas]')
      if (!canvasEl) { alert('Could not find canvas to export.'); setExportingPDF(false); return }
      const rendered = await window.html2canvas(canvasEl, { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' })
      const imgData = rendered.toDataURL('image/png')
      const { jsPDF } = window.jspdf
      const pdf = new jsPDF({ orientation: rendered.width > rendered.height ? 'landscape' : 'portrait', unit: 'px', format: [rendered.width / 2, rendered.height / 2] })
      pdf.addImage(imgData, 'PNG', 0, 0, rendered.width / 2, rendered.height / 2)
      pdf.save(`${survey?.name || 'survey'}.pdf`)
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

  const toolbarModes = [
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
        <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a18', marginLeft: 4 }}>{survey?.name}</span>
        {isShared && <span style={{ background: '#E24B4A', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 500 }}>Redline view</span>}
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
        <button style={tbBtn} onClick={() => setShowScale(true)}><i className="ti ti-ruler" /> Scale</button>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className="ti ti-layout-grid" style={{ fontSize: 13, color: '#888' }} />
          <input type="range" min="20" max="80" step="2" value={iconSize}
            onChange={e => updateIconSize(parseInt(e.target.value))}
            style={{ width: 64 }} title="Icon size" />
          <span style={{ fontSize: 11, color: '#888', minWidth: 24 }}>{iconSize}px</span>
        </div>

        <span style={{ marginLeft: 'auto', fontSize: 11, color: saving ? '#BA7517' : '#1D9E75' }}>
          {saving ? 'Saving…' : saveMsg}
        </span>
      </div>

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
              <div style={{ height: 8, borderRadius: 4, background: 'linear-gradient(to right,rgba(0,180,100,0.3),rgba(255,200,0,0.8),rgba(255,50,0,1))', marginBottom: 3 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888' }}><span>Weak</span><span>Strong</span></div>
            </div>
          </div>
        )}

        <SurveyCanvas
          devices={devices} cables={cables} svgMarkup={svgMarkup}
          pxPerFt={pxPerFt} showHeatmap={showHeatmap}
          mode={mode} activeCableType={activeCableType}
          onDeviceAdd={handleDeviceAdd} onDeviceMove={handleDeviceMove} onDeviceSelect={handleDeviceSelect}
          onCableAdd={handleCableAdd} onCableSelect={handleCableSelect}
          onMarkupChange={updateMarkup}
          selectedId={selectedId} selectedCableId={selectedCableId}
          floorPlanUrl={floorPlanUrl}
          floorPlanRotation={floorPlanRotation}
          iconSize={iconSize}
        />

        <div style={{ width: 172, flexShrink: 0, background: '#f8f8f6', borderLeft: '0.5px solid #e0dfd8', padding: 12, overflowY: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: '#1a1a18' }}>Properties</div>

          {!selectedDevice && !selectedCable && (
            <p style={{ fontSize: 12, color: '#888' }}>Select a device or cable.</p>
          )}

          {selectedDevice && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
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
                    onChange={e => updateSelectedDevice(f.field, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)} />
                </div>
              ))}
              <div>
                <label style={propLabel}>Notes</label>
                <textarea style={{ ...propInput, minHeight: 48, resize: 'vertical' }} placeholder="Mount height, port…"
                  value={selectedDevice.notes || ''} onChange={e => updateSelectedDevice('notes', e.target.value)} />
              </div>
              {selectedDevice.dtype === 'rak-gw' && (
                <>
                  <div>
                    <label style={propLabel}>LoRa range: <strong>{selectedDevice.hmRangeFt || 150} ft</strong></label>
                    <input type="range" min="25" max="300" step="5" style={{ width: '100%' }}
                      value={selectedDevice.hmRangeFt || 150}
                      onChange={e => updateSelectedDevice('hmRangeFt', parseInt(e.target.value))} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888' }}>
                      <span>25 ft</span><span>300 ft</span>
                    </div>
                  </div>
                  <div>
                    <label style={propLabel}>Signal strength</label>
                    <select style={propInput} value={selectedDevice.hmStrength || 1}
                      onChange={e => updateSelectedDevice('hmStrength', parseFloat(e.target.value))}>
                      <option value="1">Strong (open)</option>
                      <option value="0.75">Medium</option>
                      <option value="0.5">Weak (walls)</option>
                    </select>
                  </div>
                </>
              )}
              {!isShared && (
                <button onClick={deleteSelectedDevice} style={dangerBtn}>
                  <i className="ti ti-trash" /> Remove device
                </button>
              )}
            </div>
          )}

          {selectedCable && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div>
                <label style={propLabel}>Type</label>
                <select style={propInput} value={selectedCable.type || 'cat6'}
                  onChange={e => updateSelectedCable('type', e.target.value)}>
                  {Object.keys(CABLE_STYLES).map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={propLabel}>Label</label>
                <input style={propInput} type="text" placeholder="e.g. Cam 1 → Switch"
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
const propLabel = { display: 'block', fontSize: 11, color: '#666', marginBottom: 3 }
const propInput = { width: '100%', fontSize: 12, padding: '5px 7px', border: '0.5px solid #ccc', borderRadius: 6, background: '#fff', color: '#1a1a18', boxSizing: 'border-box', outline: 'none' }
const modalTitle = { fontSize: 15, fontWeight: 500, marginBottom: 12, color: '#1a1a18', margin: '0 0 12px' }
const bomCell = { padding: '6px 8px', borderBottom: '0.5px solid #e0dfd8', color: '#1a1a18' }

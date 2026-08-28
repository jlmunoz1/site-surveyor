import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getEnterprise, getProjects, getSurveys } from '../lib/supabase'
import SurveyCanvas from '../components/SurveyCanvas'
import { buildSurveyPdfBlob, downloadBlob, safeFileName, ensureJSZipLoaded } from '../lib/exportPdf'

// How long to wait for a single survey's floor plan to finish loading
// (image fetch, or PDF.js page render) before giving up on it and
// moving on to the next one — a slow/broken floor plan shouldn't stall
// the whole batch indefinitely.
const PER_SURVEY_TIMEOUT_MS = 20000
// Small buffer after the "ready" signal fires, before capturing — lets
// the browser finish painting (fonts, icons) rather than screenshotting
// mid-frame.
const SETTLE_DELAY_MS = 350

export default function BulkExport() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [enterprise, setEnterprise] = useState(null)
  const [items, setItems] = useState([]) // [{ survey, projectName }]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState([]) // [{ surveyId, name, projectName, status: 'pending'|'success'|'error', error }]
  const [renderSurvey, setRenderSurvey] = useState(null) // the one survey currently mounted off-screen for capture
  const canvasRef = useRef(null)
  const readyResolveRef = useRef(null)

  useEffect(() => { loadAll() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true)
    const [{ data: ent, error: entError }, { data: allProjects }, { data: allSurveys }] = await Promise.all([
      getEnterprise(id),
      getProjects(),
      getSurveys(),
    ])
    if (entError || !ent) { setError('Enterprise not found.'); setLoading(false); return }
    setEnterprise(ent)
    const projectIds = new Set((allProjects || []).filter(p => p.enterprise_id === id).map(p => p.id))
    const projectNameById = {}
    ;(allProjects || []).forEach(p => { projectNameById[p.id] = p.name })
    const relevant = (allSurveys || [])
      .filter(s => projectIds.has(s.project_id))
      .map(s => ({ survey: s, projectName: projectNameById[s.project_id] || 'Project' }))
    setItems(relevant)
    setLoading(false)
  }

  async function handleStartExport() {
    if (items.length === 0) return
    setExporting(true)
    setResults(items.map(({ survey, projectName }) => ({ surveyId: survey.id, name: survey.name, projectName, status: 'pending', error: null })))
    setProgress({ done: 0, total: items.length })

    await ensureJSZipLoaded()
    const zip = new window.JSZip()
    let successCount = 0

    for (let i = 0; i < items.length; i++) {
      const { survey, projectName } = items[i]
      try {
        await renderAndWait(survey)
        // Small settle delay so the browser finishes painting before
        // html2canvas grabs a frame.
        await new Promise(r => setTimeout(r, SETTLE_DELAY_MS))

        const canvasEl = document.querySelector('[data-bulk-export-canvas] [data-export-canvas]')
        if (!canvasEl) throw new Error('Canvas did not render')
        const canvasBounds = canvasRef.current?.getFloorPlanBounds?.()
        const blob = await buildSurveyPdfBlob({ canvasEl, canvasBounds, survey, devices: survey.devices || [] })

        const folder = safeFileName(projectName)
        const fileName = safeFileName(survey.name) + '.pdf'
        zip.file(`${folder}/${fileName}`, blob)

        successCount++
        setResults(rs => rs.map(r => r.surveyId === survey.id ? { ...r, status: 'success' } : r))
      } catch (err) {
        setResults(rs => rs.map(r => r.surveyId === survey.id ? { ...r, status: 'error', error: err.message || 'Export failed' } : r))
      } finally {
        setRenderSurvey(null)
        setProgress(p => ({ ...p, done: i + 1 }))
      }
    }

    if (successCount > 0) {
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `${safeFileName(enterprise?.name || 'export')}-PDFs.zip`)
    }
    setExporting(false)
  }

  // Mounts the given survey off-screen, waits for its floor plan to
  // finish loading (via onFloorPlanReady), and resolves once it's safe
  // to capture — or times out and resolves anyway (better to export a
  // possibly-incomplete capture than to hang the whole batch).
  function renderAndWait(survey) {
    return new Promise(resolve => {
      readyResolveRef.current = resolve
      setRenderSurvey(survey)
      const timeout = setTimeout(() => {
        if (readyResolveRef.current === resolve) { readyResolveRef.current = null; resolve() }
      }, PER_SURVEY_TIMEOUT_MS)
      readyResolveRef.current = () => { clearTimeout(timeout); resolve() }
    })
  }

  function handleFloorPlanReady() {
    if (readyResolveRef.current) { readyResolveRef.current(); readyResolveRef.current = null }
  }

  if (loading) return <div style={{ padding: 40, color: '#888', fontSize: 13 }}>Loading…</div>
  if (error) return <div style={{ padding: 40, color: '#A32D2D', fontSize: 13 }}>{error}</div>

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <button onClick={() => navigate('/')} style={ghostBtn}><i className="ti ti-arrow-left" /> Back to dashboard</button>

      <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1a18', margin: '16px 0 4px' }}>
        Export all PDFs — {enterprise?.name}
      </h1>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>
        {items.length} survey{items.length !== 1 ? 's' : ''} across every project under this enterprise. Each one is rendered exactly like the "Export PDF" button in the editor, then bundled into a single zip.
      </p>

      {!exporting && results.length === 0 && (
        <button onClick={handleStartExport} disabled={items.length === 0} style={primaryBtn}>
          <i className="ti ti-download" style={{ marginRight: 6 }} /> Export {items.length} PDF{items.length !== 1 ? 's' : ''} as .zip
        </button>
      )}

      {items.length === 0 && (
        <p style={{ fontSize: 13, color: '#aaa' }}>No surveys found under this enterprise's projects yet.</p>
      )}

      {(exporting || results.length > 0) && (
        <div style={{ marginTop: 8 }}>
          {exporting && (
            <div style={{ fontSize: 13, color: '#378ADD', marginBottom: 12 }}>
              Exporting {progress.done} of {progress.total}…
              <div style={{ height: 6, background: '#eeede7', borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#378ADD', width: `${(progress.done / Math.max(1, progress.total)) * 100}%`, transition: 'width 0.2s' }} />
              </div>
            </div>
          )}
          {!exporting && (
            <div style={{ fontSize: 13, color: '#1D9E75', marginBottom: 12 }}>
              <i className="ti ti-circle-check" /> Done — {results.filter(r => r.status === 'success').length} of {results.length} exported successfully.
              {results.some(r => r.status === 'error') && ' Your zip download started with the successful ones; failed surveys are listed below.'}
            </div>
          )}
          <div style={{ border: '0.5px solid #e0dfd8', borderRadius: 8, overflow: 'hidden' }}>
            {results.map(r => (
              <div key={r.surveyId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '0.5px solid #f0efe9', fontSize: 12.5 }}>
                {r.status === 'pending' && <i className="ti ti-clock" style={{ color: '#bbb' }} />}
                {r.status === 'success' && <i className="ti ti-circle-check" style={{ color: '#1D9E75' }} />}
                {r.status === 'error' && <i className="ti ti-alert-circle" style={{ color: '#A32D2D' }} />}
                <span style={{ color: '#888' }}>{r.projectName} /</span>
                <span style={{ color: '#1a1a18' }}>{r.name}</span>
                {r.status === 'error' && <span style={{ color: '#A32D2D', marginLeft: 'auto', fontSize: 11 }}>{r.error}</span>}
              </div>
            ))}
          </div>
          {!exporting && (
            <button onClick={handleStartExport} style={{ ...ghostBtn, marginTop: 14 }}>
              <i className="ti ti-refresh" /> Run again
            </button>
          )}
        </div>
      )}

      {/* Off-screen render target — deliberately positioned far off
          the visible page (not display:none, which would break
          html2canvas's layout measurement) rather than hidden, so
          each survey's floor plan and devices render exactly the way
          they would in the real editor before being captured. */}
      <div data-bulk-export-canvas style={{ position: 'fixed', top: 0, left: -100000, width: 1400, height: 1000, background: '#fff' }}>
        {renderSurvey && (
          <SurveyCanvas
            ref={canvasRef}
            devices={renderSurvey.devices || []}
            cables={renderSurvey.cables || []}
            svgMarkup={renderSurvey.svg_markup || ''}
            pxPerFt={renderSurvey.px_per_ft || 4}
            showHeatmap={false}
            mode="select"
            selectedId={null}
            selectedCableId={null}
            floorPlanUrl={renderSurvey.floor_plan_url || ''}
            floorPlanPage={renderSurvey.floor_plan_page || 1}
            floorPlanRotation={renderSurvey.floor_plan_rotation || 0}
            iconSizes={typeof renderSurvey.icon_sizes === 'object' ? renderSurvey.icon_sizes : undefined}
            labelSizes={typeof renderSurvey.label_sizes === 'object' ? renderSurvey.label_sizes : undefined}
            hiddenLabelTypes={Array.isArray(renderSurvey.hidden_label_types) ? renderSurvey.hidden_label_types : []}
            readOnly
            onFloorPlanReady={handleFloorPlanReady}
          />
        )}
      </div>
    </div>
  )
}

const ghostBtn = { padding: '7px 14px', background: '#fff', color: '#444', border: '0.5px solid #ccc', borderRadius: 7, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }
const primaryBtn = { padding: '9px 16px', background: '#1a1a18', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center' }

// Detects existing device/gateway markers already drawn on an imported
// PDF floor plan (e.g. a System Surveyor export) so they can be added
// as real, editable Site Surveyor devices instead of staying flattened
// pixels. Renders the page client-side, sends it to a Vercel serverless
// function that calls Claude's vision API, then maps the normalized
// (0-1) coordinates it returns back into the same "PDF points" space
// SurveyCanvas already stores device x/y in.
import { renderPdfPageToImage } from './pdf'
import { DEVICE_DEFS } from './devices'

const ALL_DTYPES = DEVICE_DEFS.flatMap(section => section.items.map(i => ({ dtype: i.dtype, label: i.label })))

export async function detectDevicesFromPdf(floorPlanUrl, floorPlanPage) {
  let rendered
  try {
    rendered = await renderPdfPageToImage(floorPlanUrl, floorPlanPage)
  } catch (err) {
    return { markers: [], error: 'Could not render the PDF page: ' + (err.message || err) }
  }

  let response, data
  try {
    response = await fetch('/api/detect-floor-plan-devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: rendered.dataUrl, deviceTypes: ALL_DTYPES }),
    })
    data = await response.json()
  } catch (err) {
    return { markers: [], error: 'Detection request failed: ' + (err.message || err) }
  }
  if (!response.ok) {
    return { markers: [], error: data?.error || 'Detection failed' }
  }

  const markers = (Array.isArray(data.markers) ? data.markers : []).map(m => ({
    // Convert from the fraction-of-image-dimensions the model returns
    // into the floor plan's native point space, matching where devices
    // placed by hand already live.
    x: m.x * rendered.pdfWidthPts,
    y: m.y * rendered.pdfHeightPts,
    dtype: m.dtype,
    label: m.label || '',
  }))
  return { markers, error: null }
}

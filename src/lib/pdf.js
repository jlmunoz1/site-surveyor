// Shared helper for loading pdf.js from CDN and reading basic info from
// a PDF, used by both the Dashboard (uploading a multi-page floor plan
// before any survey exists) and SurveyEditor (uploading/replacing a
// floor plan on an existing survey).

export async function ensurePdfJsLoaded() {
  if (window.pdfjsLib) return
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
}

export async function getPdfPageCount(url) {
  await ensurePdfJsLoaded()
  const pdf = await window.pdfjsLib.getDocument(url).promise
  return pdf.numPages
}

// Renders one page of a PDF to a PNG data URL for sending to the AI
// device-detection endpoint. Also returns the page's native "point"
// dimensions (scale: 1) — this is the exact coordinate space that
// SurveyCanvas already stores device x/y in for PDF floor plans (see
// the displayScale math in SurveyCanvas's PDF loader), so detected
// marker positions can be mapped straight onto the floor plan without
// any extra scale bookkeeping once they're converted out of the
// image's own pixel space.
export async function renderPdfPageToImage(url, pageNum = 1, maxDim = 1568) {
  await ensurePdfJsLoaded()
  const pdf = await window.pdfjsLib.getDocument(url).promise
  const safePage = Math.min(Math.max(1, pageNum || 1), pdf.numPages)
  const page = await pdf.getPage(safePage)
  const basePoints = page.getViewport({ scale: 1 })
  // Render at a resolution generous enough for small on-plan markers
  // and text (like "IDF 1-1") to stay legible to the model, capped so
  // the upload stays a reasonable size.
  const scale = Math.min(maxDim / basePoints.width, maxDim / basePoints.height, 4)
  const vp = page.getViewport({ scale: Math.max(scale, 0.5) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
  return {
    dataUrl: canvas.toDataURL('image/png'),
    pdfWidthPts: basePoints.width,
    pdfHeightPts: basePoints.height,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
  }
}

// Same PDF-vs-image sniffing logic used by SurveyCanvas — kept here too
// so callers that only need the yes/no answer (e.g. deciding whether to
// show a "Detect Devices" button) don't have to duplicate the regex.
export function isPdfUrl(url) {
  if (!url) return false
  return url.includes('.pdf') || (url.includes('%2F') && !url.match(/\.(jpg|jpeg|png|gif|webp)/i))
}

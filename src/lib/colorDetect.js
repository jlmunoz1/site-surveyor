// Detects device markers already drawn on an imported floor plan by
// matching a known marker color and clustering the matching pixels
// into blobs — no AI call, no API key, and it runs entirely in the
// browser. This works because tools like System Surveyor draw every
// device pin in one consistent color (a bright purple/magenta here —
// confirmed by sampling a real export, see RGB below), with the
// specific device type and number written as plain text next to the
// pin rather than encoded into the icon's color or shape. That means
// color matching finds WHERE markers are, for free and instantly; it
// can't read the "GW 74" text beside them, so detected markers come
// back with a blank label for the person to fill in during review.
import { renderPdfPageToImage, isPdfUrl } from './pdf'

// Sampled directly from a real System Surveyor export (see chat
// history) — every gateway marker on that plan matched this almost
// exactly. Tolerance is generous enough to survive compression
// artifacts and anti-aliased edges around each marker's outline.
export const DEFAULT_MARKER_COLOR = { r: 199, g: 81, b: 238 }
const DEFAULT_TOLERANCE = 42
const DEFAULT_MIN_PIXELS = 15

async function renderFloorPlanForDetection(floorPlanUrl, floorPlanPage, maxDim = 2200) {
  if (isPdfUrl(floorPlanUrl)) {
    const rendered = await renderPdfPageToImage(floorPlanUrl, floorPlanPage, maxDim)
    const img = new Image()
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = rendered.dataUrl })
    const canvas = document.createElement('canvas')
    canvas.width = rendered.pixelWidth
    canvas.height = rendered.pixelHeight
    canvas.getContext('2d').drawImage(img, 0, 0)
    return { canvas, pointWidth: rendered.pdfWidthPts, pointHeight: rendered.pdfHeightPts }
  }
  // Plain image floor plan — device x/y already live in the image's
  // own natural pixel dimensions (see SurveyCanvas's "image" branch),
  // so no scaling is needed between detection space and the space
  // devices are stored in.
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => { const img2 = new Image(); img2.onload = resolve; img2.onerror = reject; img2.src = floorPlanUrl }
    img.src = floorPlanUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d').drawImage(img, 0, 0)
  return { canvas, pointWidth: img.naturalWidth, pointHeight: img.naturalHeight }
}

function colorMatches(r, g, b, target, tolerance) {
  return Math.abs(r - target.r) <= tolerance &&
    Math.abs(g - target.g) <= tolerance &&
    Math.abs(b - target.b) <= tolerance &&
    g < r - 20 && g < b - 20 // purple/magenta signature — green notably lower than red & blue, filters out grays/whites
}

// Connected-component clustering over the color mask via flood fill —
// fast enough for a floor-plan-sized canvas (a few million pixels)
// without pulling in an image-processing library.
function findBlobs(imageData, width, height, target, tolerance, minPixels) {
  const data = imageData.data
  const total = width * height
  const matches = new Uint8Array(total)
  for (let i = 0, p = 0; p < total; i += 4, p++) {
    if (colorMatches(data[i], data[i + 1], data[i + 2], target, tolerance)) matches[p] = 1
  }
  const visited = new Uint8Array(total)
  const stackX = new Int32Array(total)
  const stackY = new Int32Array(total)
  const blobs = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (!matches[idx] || visited[idx]) continue
      let sp = 0
      stackX[sp] = x; stackY[sp] = y; sp++
      visited[idx] = 1
      let sumX = 0, sumY = 0, count = 0
      while (sp > 0) {
        sp--
        const cx = stackX[sp], cy = stackY[sp]
        sumX += cx; sumY += cy; count++
        if (cx + 1 < width) { const n = cy * width + (cx + 1); if (matches[n] && !visited[n]) { visited[n] = 1; stackX[sp] = cx + 1; stackY[sp] = cy; sp++ } }
        if (cx - 1 >= 0) { const n = cy * width + (cx - 1); if (matches[n] && !visited[n]) { visited[n] = 1; stackX[sp] = cx - 1; stackY[sp] = cy; sp++ } }
        if (cy + 1 < height) { const n = (cy + 1) * width + cx; if (matches[n] && !visited[n]) { visited[n] = 1; stackX[sp] = cx; stackY[sp] = cy + 1; sp++ } }
        if (cy - 1 >= 0) { const n = (cy - 1) * width + cx; if (matches[n] && !visited[n]) { visited[n] = 1; stackX[sp] = cx; stackY[sp] = cy - 1; sp++ } }
      }
      if (count >= minPixels) blobs.push({ x: sumX / count, y: sumY / count, pixelCount: count })
    }
  }
  return blobs
}

// Returns { markers: [{x,y}], error } with x/y already converted into
// the same coordinate space SurveyCanvas stores device x/y in (PDF
// points for PDF floor plans, natural pixel dimensions for images).
export async function detectMarkersByColor(floorPlanUrl, floorPlanPage, opts = {}) {
  const target = opts.color || DEFAULT_MARKER_COLOR
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE
  const minPixels = opts.minPixels ?? DEFAULT_MIN_PIXELS

  let rendered
  try {
    rendered = await renderFloorPlanForDetection(floorPlanUrl, floorPlanPage)
  } catch (err) {
    return { markers: [], error: 'Could not render the floor plan: ' + (err.message || err) }
  }
  const { canvas, pointWidth, pointHeight } = rendered
  const ctx = canvas.getContext('2d')
  let imageData
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  } catch (err) {
    return { markers: [], error: 'Could not read floor plan pixels (cross-origin image) — try re-uploading it.' }
  }

  const blobs = findBlobs(imageData, canvas.width, canvas.height, target, tolerance, minPixels)
  const scaleX = pointWidth / canvas.width
  const scaleY = pointHeight / canvas.height
  const markers = blobs.map(b => ({ x: b.x * scaleX, y: b.y * scaleY }))
  return { markers, error: null }
}

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

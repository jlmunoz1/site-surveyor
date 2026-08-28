import { getPortMapperRackDevices } from './supabase'

const NETWORK_MAPPER_DTYPES = ['mdf', 'idf', 'switch']

async function loadScriptOnce(src, globalCheck) {
  if (globalCheck()) return
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
}

export async function ensurePdfExportLibsLoaded() {
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => window.jspdf)
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => window.html2canvas)
}

export async function ensureJSZipLoaded() {
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', () => window.JSZip)
}

// Builds a survey's export PDF (floor plan capture + Network Equipment
// Key page) and returns it as a Blob, rather than triggering a browser
// download directly — so callers can either save it immediately (the
// single-survey "Export PDF" button) or collect many of them into a
// zip (bulk enterprise export) without duplicating this logic.
//
// `canvasEl` must be the actual DOM node with [data-export-canvas],
// already fully rendered (floor plan loaded, devices drawn) — this
// function only captures and packages, it doesn't wait for anything.
export async function buildSurveyPdfBlob({ canvasEl, canvasBounds, survey, devices }) {
  await ensurePdfExportLibsLoaded()

  const PAD = 24
  const captureOpts = { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' }
  if (canvasBounds) {
    const elRect = canvasEl.getBoundingClientRect()
    captureOpts.x = Math.max(0, Math.floor(canvasBounds.left - PAD))
    captureOpts.y = Math.max(0, Math.floor(canvasBounds.top - PAD))
    captureOpts.width = Math.min(elRect.width - captureOpts.x, Math.ceil(canvasBounds.width + PAD * 2))
    captureOpts.height = Math.min(elRect.height - captureOpts.y, Math.ceil(canvasBounds.height + PAD * 2))
  }

  const rendered = await window.html2canvas(canvasEl, captureOpts)
  const imgData = rendered.toDataURL('image/png')
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ orientation: rendered.width > rendered.height ? 'landscape' : 'portrait', unit: 'px', format: [rendered.width / 2, rendered.height / 2] })
  pdf.addImage(imgData, 'PNG', 0, 0, rendered.width / 2, rendered.height / 2)

  const rackDevices = (devices || []).filter(d => NETWORK_MAPPER_DTYPES.includes(d.dtype))
  if (rackDevices.length > 0) {
    const results = await Promise.all(
      rackDevices.map(async d => {
        if (!d.portMapperRackId) return { device: d, devices: null, error: null }
        const r = await getPortMapperRackDevices(d.portMapperRackId)
        return { device: d, devices: r.devices, error: r.error }
      })
    )

    pdf.addPage([850, 1100], 'portrait')
    const pageH = 1100
    const margin = 40
    let y = margin

    pdf.setTextColor(0, 0, 0)
    pdf.setFontSize(16); pdf.setFont('helvetica', 'bold')
    pdf.text('Network Equipment Key', margin, y)
    y += 30

    results.forEach(({ device, devices: equipment, error }) => {
      if (y > pageH - 60) { pdf.addPage([850, 1100], 'portrait'); y = margin }
      pdf.setFontSize(12); pdf.setFont('helvetica', 'bold')
      const rackName = device.rackId || device.label
      const heading = device.rackId && device.rackId !== device.label ? `${rackName} (${device.label})` : rackName
      pdf.text(heading, margin, y)
      y += 18
      pdf.setFontSize(10); pdf.setFont('helvetica', 'normal')
      if (!device.portMapperRackId) {
        pdf.setTextColor(140, 140, 140)
        pdf.text('Not yet linked to Network Mapper.', margin + 14, y)
        pdf.setTextColor(0, 0, 0)
        y += 16
      } else if (error) {
        pdf.setTextColor(160, 45, 45)
        pdf.text(`Couldn't load equipment: ${error}`, margin + 14, y)
        pdf.setTextColor(0, 0, 0)
        y += 16
      } else if (!equipment || equipment.length === 0) {
        pdf.setTextColor(140, 140, 140)
        pdf.text('No equipment added in Network Mapper yet.', margin + 14, y)
        pdf.setTextColor(0, 0, 0)
        y += 16
      } else {
        equipment.forEach(eq => {
          if (y > pageH - 40) { pdf.addPage([850, 1100], 'portrait'); y = margin }
          const line = eq.ports ? `•  ${eq.label}  (${eq.ports}p)` : `•  ${eq.label}`
          pdf.text(line, margin + 14, y)
          y += 16
        })
      }
      y += 14
    })
  }

  return pdf.output('blob')
}

// Triggers a browser download of a blob without needing FileSaver.js —
// standard temporary-anchor-element trick.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Filesystem-safe-ish name for a PDF/zip entry — strips characters that
// break on Windows/zip readers, without being paranoid about it.
export function safeFileName(name) {
  return (name || 'untitled').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'untitled'
}

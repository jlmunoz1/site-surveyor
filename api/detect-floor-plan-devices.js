// Vercel serverless function. Sends a rendered floor-plan page image to
// the Claude API (vision) and asks it to locate any device/gateway
// markers already drawn on the plan — imported PDFs (e.g. System
// Surveyor exports) are flattened raster images with no embedded
// metadata, so the only way to find existing markers is to look at the
// picture. Returns normalized (0-1) coordinates so the client can map
// them back onto the floor plan regardless of render resolution. Uses
// Site Surveyor's own Anthropic API key, read only server-side — it is
// never sent to or exposed in the browser.
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-5'

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY' })
    return
  }

  const { image, deviceTypes } = req.body || {}
  if (!image || typeof image !== 'string' || !image.startsWith('data:image')) {
    res.status(400).json({ error: 'A base64 image data URL is required' })
    return
  }
  const match = image.match(/^data:(image\/\w+);base64,(.+)$/)
  if (!match) {
    res.status(400).json({ error: 'Malformed image data URL' })
    return
  }
  const [, mediaType, base64Data] = match

  const validDtypes = Array.isArray(deviceTypes) && deviceTypes.length
    ? deviceTypes.filter(t => t && typeof t.dtype === 'string')
    : [{ dtype: 'mdf', label: 'MDF' }, { dtype: 'idf', label: 'IDF' }, { dtype: 'rak-gw', label: 'Gateway' }]
  const typeList = validDtypes.map(t => `- "${t.dtype}": ${t.label}`).join('\n')

  const prompt = `You are looking at a floor plan page exported from a network survey tool. Some device/equipment markers may already be drawn directly on it — icons, colored circles or dots, or small labeled boxes.

Find every such EXISTING device marker already drawn on this floor plan. Do not invent markers that aren't there, and ignore ordinary architectural symbols (doors, fixtures, dimension lines) that aren't network/security equipment markers.

Read the actual text printed on or next to each marker — this is the most reliable signal, far more reliable than guessing from icon shape or color alone:
- Text reading "GW" followed by a number, or "Gateway" followed by a number (e.g. "GW 1", "GW-2", "Gateway 3") is always a gateway → dtype "rak-gw". Treat this text pattern as decisive: if you see it, classify the marker as a gateway even if its icon/color looks unfamiliar.
- Text reading "IDF" plus a number/room (e.g. "IDF 1-1") is an IDF → dtype "idf".
- Text reading "MDF" is an MDF → dtype "mdf".
- If a marker has no legible text, fall back to judging its icon/shape/color against the type list below.

For each marker found, report:
- "x" and "y": its center position as a FRACTION of the image width/height respectively (each a number between 0 and 1, top-left origin)
- "x0","y0","x1","y1": a tight bounding box around the marker's icon/dot ONLY (not the text label beside it) as fractions of image width/height, top-left origin — used to size a patch that covers just the icon
- "dtype": the closest matching type from this exact list of strings:
${typeList}
  If nothing matches well, use "sage-equip".
- "label": the exact text found on/near the marker (e.g. "GW 1", "IDF 1-1"), or "" if none is legible

Respond with ONLY a raw JSON array, no markdown fences and no other text, e.g.:
[{"x":0.42,"y":0.31,"x0":0.40,"y0":0.29,"x1":0.44,"y1":0.33,"dtype":"rak-gw","label":"GW 1"}]

If you find no markers, respond with exactly: []`

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      res.status(500).json({ error: data?.error?.message || 'Claude API request failed' })
      return
    }

    const textBlock = (data.content || []).find(b => b.type === 'text')
    let markers = []
    if (textBlock?.text) {
      const cleaned = textBlock.text.replace(/```json|```/g, '').trim()
      try {
        const parsed = JSON.parse(cleaned)
        if (Array.isArray(parsed)) markers = parsed
      } catch (parseErr) {
        console.warn('Could not parse device-detection response as JSON:', textBlock.text)
      }
    }

    const validDtypeSet = new Set(validDtypes.map(t => t.dtype))
    const clamp01 = v => Math.max(0, Math.min(1, v))
    markers = markers
      .filter(m => m && typeof m.x === 'number' && typeof m.y === 'number' && m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1)
      .map(m => {
        const out = {
          x: m.x,
          y: m.y,
          dtype: validDtypeSet.has(m.dtype) ? m.dtype : 'sage-equip',
          label: typeof m.label === 'string' ? m.label.slice(0, 120) : '',
        }
        const hasBox = ['x0', 'y0', 'x1', 'y1'].every(k => typeof m[k] === 'number')
        if (hasBox) {
          const x0 = clamp01(m.x0), y0 = clamp01(m.y0), x1 = clamp01(m.x1), y1 = clamp01(m.y1)
          // Only keep the box if it's sane (non-inverted, non-zero, and
          // not absurdly large) — otherwise drop it and let the client
          // fall back to icon-based sizing rather than trust a bad box.
          // Guards both directions — too big (blankets real content,
          // the original bug) and too small (a near-zero/degenerate
          // box that produces a practically invisible cover patch,
          // which is what actually happened here).
          if (x1 > x0 && y1 > y0 && (x1 - x0) >= 0.008 && (y1 - y0) >= 0.008 && (x1 - x0) < 0.08 && (y1 - y0) < 0.08) {
            out.x0 = x0; out.y0 = y0; out.x1 = x1; out.y1 = y1
          }
        }
        return out
      })

    res.status(200).json({ markers })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error detecting devices' })
  }
}

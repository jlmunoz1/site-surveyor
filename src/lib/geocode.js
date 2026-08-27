// Turns a typed address into a lat/lng using OpenStreetMap's free
// Nominatim geocoder — no API key needed, consistent with the
// no-key satellite basemap already used in the georeferencing tool.
//
// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// asks for a low request rate and an identifying User-Agent/Referer.
// Browsers won't let JS set a custom User-Agent header, but they do
// send the page's Referer automatically, which is what Nominatim's
// policy actually checks for browser-based usage. This is fine for
// occasional, human-triggered lookups (someone typing in an address
// and clicking "Locate") — it is not meant for bulk/automated geocoding.
export async function geocodeAddress(address) {
  const trimmed = (address || '').trim()
  if (!trimmed) return { lat: null, lng: null, error: new Error('No address provided.') }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`
    const res = await fetch(url)
    if (!res.ok) return { lat: null, lng: null, error: new Error(`Geocoding service returned ${res.status}`) }
    const results = await res.json()
    if (!results || results.length === 0) {
      return { lat: null, lng: null, error: new Error("Couldn't find that address — try adding city/state or double-checking it.") }
    }
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon), error: null }
  } catch (err) {
    return { lat: null, lng: null, error: err }
  }
}

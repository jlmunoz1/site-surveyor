import L from 'leaflet'

// A Leaflet image overlay that's skewed and rotated to fit three
// real-world corner points (top-left, top-right, bottom-left) instead
// of sitting axis-aligned in a lat/lng bounding box. This is what lets
// a floor plan sit on the map at whatever rotation and stretch the
// ground control points implied, rather than only ever appearing
// perfectly north-up.
//
// This is a small from-scratch implementation, not a wrapper around a
// third-party plugin — it only needs to do what the georeferencing
// tool actually uses: add/remove from the map, live opacity, and
// re-fitting the CSS transform on pan/zoom/resize.
//
// The math: CSS's matrix(a, b, c, d, e, f) maps a point (x, y) in the
// element's own pixel space to (a*x + c*y + e, b*x + d*y + f) in screen
// space. We know where the image's three corners — (0,0), (w,0), (0,h)
// — need to land on screen (by converting their real-world lat/lng to
// current screen pixels), so we solve directly for a..f from those
// three correspondences.
export const RotatedImageOverlay = L.Layer.extend({
  initialize(imageUrl, corners, options) {
    this._url = imageUrl
    this._corners = corners // { topLeft: {lat,lng}, topRight, bottomLeft }
    L.Util.setOptions(this, options)
  },

  onAdd(map) {
    this._map = map
    if (!this._image) {
      this._image = L.DomUtil.create('img', 'site-surveyor-geo-overlay')
      this._image.style.position = 'absolute'
      this._image.style.transformOrigin = '0 0'
      this._image.style.pointerEvents = 'none'
      this._image.style.opacity = this.options.opacity ?? 1
      this._image.onload = () => this._reset()
      this._image.src = this._url
    }
    map.getPanes().overlayPane.appendChild(this._image)
    map.on('moveend zoomend resize', this._reset, this)
    this._reset()
    return this
  },

  onRemove(map) {
    L.DomUtil.remove(this._image)
    map.off('moveend zoomend resize', this._reset, this)
  },

  setOpacity(opacity) {
    this.options.opacity = opacity
    if (this._image) this._image.style.opacity = opacity
  },

  setCorners(corners) {
    this._corners = corners
    this._reset()
  },

  _reset() {
    if (!this._map || !this._image || !this._image.naturalWidth || !this._corners) return
    const map = this._map
    const w = this._image.naturalWidth
    const h = this._image.naturalHeight

    const tl = map.latLngToLayerPoint(this._corners.topLeft)
    const tr = map.latLngToLayerPoint(this._corners.topRight)
    const bl = map.latLngToLayerPoint(this._corners.bottomLeft)

    const a = (tr.x - tl.x) / w
    const b = (tr.y - tl.y) / w
    const c = (bl.x - tl.x) / h
    const d = (bl.y - tl.y) / h

    this._image.style.width = w + 'px'
    this._image.style.height = h + 'px'
    this._image.style.left = '0px'
    this._image.style.top = '0px'
    this._image.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${tl.x}, ${tl.y})`
  },
})

export function rotatedImageOverlay(imageUrl, corners, options) {
  return new RotatedImageOverlay(imageUrl, corners, options)
}

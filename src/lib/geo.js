// Georeferencing math for the floor plan overlay tool.
//
// The core problem: given a handful of "this pixel on the floor plan is
// this lat/lng on the map" control points, find the transform that maps
// ANY floor-plan pixel to a lat/lng, so the whole image can be draped
// onto the satellite layer in the right place, at the right size, and
// at the right rotation.
//
// We don't fit the transform directly in lat/lng space, because degrees
// of longitude and latitude don't cover the same physical distance
// (a degree of longitude shrinks by cos(latitude) as you move away from
// the equator). Fitting there would make a square room look like a
// parallelogram. Instead we project control points into a small local
// flat-earth coordinate system (meters, relative to the first point),
// fit the transform there where "meters" behave the way you'd expect,
// then convert back to lat/lng only for display. This is standard
// practice for building-scale georeferencing and is accurate to a
// few centimeters over distances of a few hundred meters — far tighter
// than a hand-placed control point will ever be anyway.

const EARTH_RADIUS_M = 6378137

// Builds a local projection centered on `refLat`/`refLng`. `toXY` and
// `toLatLng` are exact inverses of each other for points near the
// reference — accuracy degrades gracefully (not catastrophically) as
// you move away, which is irrelevant here since a floor plan spans at
// most a few hundred meters.
export function makeLocalProjection(refLat, refLng) {
  const latRad = (refLat * Math.PI) / 180
  const metersPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M
  const metersPerDegLng = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(latRad)
  return {
    toXY(lat, lng) {
      return { x: (lng - refLng) * metersPerDegLng, y: (lat - refLat) * metersPerDegLat }
    },
    toLatLng(x, y) {
      return { lat: refLat + y / metersPerDegLat, lng: refLng + x / metersPerDegLng }
    },
  }
}

// Solves a 3x3 linear system via Gaussian elimination with partial
// pivoting. Used to fit the affine transform's coefficients. Returns
// null if the system is singular (e.g. all control points fall on a
// straight line, so there's no unique 2D fit).
function solve3x3(A, b) {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ]
  for (let col = 0; col < 3; col++) {
    let pivotRow = col
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r
    }
    if (Math.abs(M[pivotRow][col]) < 1e-9) return null
    if (pivotRow !== col) [M[col], M[pivotRow]] = [M[pivotRow], M[col]]
    for (let r = 0; r < 3; r++) {
      if (r === col) continue
      const factor = M[r][col] / M[col][col]
      for (let c = col; c < 4; c++) M[r][c] -= factor * M[col][c]
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]]
}

// Least-squares fit of x = a*px + b*py + c (and separately for y) given
// N >= 3 point pairs. Allows independent x/y scale and shear, which a
// scanned or photographed floor plan often has even when the building
// itself is square.
function fitAffineLeastSquares(pixelPts, localPts) {
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, S1 = pixelPts.length
  let SxX = 0, SyX = 0, SX = 0, SxY = 0, SyY = 0, SY = 0
  for (let i = 0; i < pixelPts.length; i++) {
    const { x: px, y: py } = pixelPts[i]
    const { x: X, y: Y } = localPts[i]
    Sxx += px * px; Sxy += px * py; Sx += px
    Syy += py * py; Sy += py
    SxX += px * X; SyX += py * X; SX += X
    SxY += px * Y; SyY += py * Y; SY += Y
  }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, S1]]
  const solX = solve3x3(A, [SxX, SyX, SX])
  const solY = solve3x3(A, [SxY, SyY, SY])
  if (!solX || !solY) return null
  const [a, b, c] = solX
  const [d, e, f] = solY
  return { a, b, c, d, e, f }
}

// Exact similarity transform (uniform scale + rotation + translation,
// no shear/stretch) from exactly 2 point pairs, via complex-number
// arithmetic: treat each pixel/local point as a complex number, solve
// local = s * pixel + t for the complex scale-and-rotation factor s and
// translation t.
function fitSimilarityFromTwoPoints(pixelPts, localPts) {
  const [p1, p2] = pixelPts
  const [q1, q2] = localPts
  const dzx = p2.x - p1.x, dzy = p2.y - p1.y
  const dwx = q2.x - q1.x, dwy = q2.y - q1.y
  const denom = dzx * dzx + dzy * dzy
  if (denom < 1e-9) return null
  // s = dw / dz (complex division)
  const sRe = (dwx * dzx + dwy * dzy) / denom
  const sIm = (dwy * dzx - dwx * dzy) / denom
  // t = q1 - s * p1
  const tx = q1.x - (sRe * p1.x - sIm * p1.y)
  const ty = q1.y - (sIm * p1.x + sRe * p1.y)
  // Expand into the same {a,b,c,d,e,f} affine shape as the 3+ point fit
  // so callers don't need to care which path was used:
  //   x = a*px + b*py + c ,  y = d*px + e*py + f
  return { a: sRe, b: -sIm, c: tx, d: sIm, e: sRe, f: ty }
}

// Fits a transform from floor-plan pixel coordinates to real-world
// lat/lng, given 2+ control points. Returns { apply(px, py) -> {lat,
// lng}, pointCount } or null if there aren't enough points yet or
// they're degenerate (e.g. collinear).
export function fitGeoTransform(points) {
  if (!points || points.length < 2) return null

  const refLat = points.reduce((s, p) => s + p.lat, 0) / points.length
  const refLng = points.reduce((s, p) => s + p.lng, 0) / points.length
  const proj = makeLocalProjection(refLat, refLng)

  const pixelPts = points.map(p => ({ x: p.px, y: p.py }))
  const localPts = points.map(p => proj.toXY(p.lat, p.lng))

  const coeffs = points.length >= 3
    ? fitAffineLeastSquares(pixelPts, localPts)
    : fitSimilarityFromTwoPoints(pixelPts, localPts)
  if (!coeffs) return null

  const { a, b, c, d, e, f } = coeffs
  return {
    pointCount: points.length,
    apply(px, py) {
      const x = a * px + b * py + c
      const y = d * px + e * py + f
      return proj.toLatLng(x, y)
    },
  }
}

// Convenience: run the fitted transform over the floor plan's three
// reference corners (top-left, top-right, bottom-left), which is all a
// rotated image overlay needs to know how to place itself.
export function computeCorners(transform, imageWidth, imageHeight) {
  if (!transform) return null
  return {
    topLeft: transform.apply(0, 0),
    topRight: transform.apply(imageWidth, 0),
    bottomLeft: transform.apply(0, imageHeight),
  }
}

// Haversine great-circle distance between two lat/lng points, in
// meters. Used to measure real-world distance for scale estimation —
// simple, standard, and plenty accurate at building scale (the flat-
// earth local projection above is used for the transform FIT itself;
// this is used only for reporting a distance back to the person).
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

const METERS_PER_FOOT = 0.3048

// Estimates the floor plan's real-world scale, in the same
// pixels-per-foot unit Site Surveyor already uses for coverage/heatmap
// math (survey.px_per_ft) — derived from the satellite-verified control
// points instead of a manual guess. Samples the fitted transform along
// the pixel x-axis and y-axis and measures the real-world distance
// each covers; averages the two, since a 3+-point affine fit can end
// up with slightly different x/y scale (a genuinely stretched scan) —
// one averaged number is what a single px_per_ft field can represent.
export function estimateScale(transform) {
  if (!transform) return null
  const SAMPLE_PX = 1000 // arbitrary — the fitted transform is linear, so any offset gives the same ratio; a larger one just keeps floating-point error negligible
  const origin = transform.apply(0, 0)
  const alongX = transform.apply(SAMPLE_PX, 0)
  const alongY = transform.apply(0, SAMPLE_PX)
  const metersPerPxX = haversineMeters(origin.lat, origin.lng, alongX.lat, alongX.lng) / SAMPLE_PX
  const metersPerPxY = haversineMeters(origin.lat, origin.lng, alongY.lat, alongY.lng) / SAMPLE_PX
  const metersPerPx = (metersPerPxX + metersPerPxY) / 2
  const feetPerPx = metersPerPx / METERS_PER_FOOT
  const pxPerFt = feetPerPx > 0 ? 1 / feetPerPx : null
  // How much the x and y scale disagree, as a % of their average — a
  // large number here is a signal the scan itself is stretched
  // unevenly (or a control point is off), not just estimation noise.
  const skewPct = metersPerPx > 0 ? (Math.abs(metersPerPxX - metersPerPxY) / metersPerPx) * 100 : 0
  return { pxPerFt, metersPerPxX, metersPerPxY, skewPct }
}

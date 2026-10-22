// Marker decluttering: which weather markers to keep when they would overlap. Pure.

export const DECLUTTER_MIN_X = 56
export const DECLUTTER_MIN_Y = 64 // a bit more vertically: the temperature pill hangs below the badge

export interface ScreenPoint {
  x: number
  y: number
  priority?: number
}

// Indexes 0..n-1 ordered so that any prefix is spread evenly: both ends, then the middle,
// then the quarters, and so on
export function spreadOrder(n: number): number[] {
  const out: number[] = []
  if (n <= 0) return out
  out.push(0)
  if (n > 1) out.push(n - 1)
  const queue: Array<[number, number]> = [[0, n - 1]]
  while (queue.length) {
    const iv = queue.shift() as [number, number]
    if (iv[1] - iv[0] < 2) continue
    const mid = (iv[0] + iv[1]) >> 1
    out.push(mid)
    queue.push([iv[0], mid], [mid, iv[1]])
  }
  return out
}

// points are in route order (x/y in screen pixels, higher priority is kept first; equal
// priorities are taken evenly spread along the route). Greedily keeps points that are not within
// opts.minX (default 56) horizontally AND opts.minY (default 64) vertically of a kept one.
// Returns the kept indexes in ascending order. At least one point is kept when there are any.
export function declutterSelect(
  points: ScreenPoint[],
  opts?: { minX?: number; minY?: number }
): number[] {
  const minX = (opts && opts.minX) || DECLUTTER_MIN_X
  const minY = (opts && opts.minY) || (opts && opts.minX) || DECLUTTER_MIN_Y
  const rank = spreadOrder(points.length)
  const spreadRank: number[] = []
  rank.forEach((idx, r) => {
    spreadRank[idx] = r
  })
  const order = points.map((_, i) => i)
  order.sort(
    (a, b) => (points[b].priority || 0) - (points[a].priority || 0) || spreadRank[a] - spreadRank[b]
  )
  const kept: number[] = []
  order.forEach((i) => {
    const p = points[i]
    const clear = kept.every(
      (k) => Math.abs(points[k].x - p.x) >= minX || Math.abs(points[k].y - p.y) >= minY
    )
    if (clear) kept.push(i)
  })
  return kept.sort((a, b) => a - b)
}

export type Point = readonly [number, number];
export type Ring = readonly Point[];
export type Polygon = readonly Ring[];

/**
 * Standard ray-casting point-in-polygon. Holes are handled by treating each
 * extra ring as a subtractive region.
 */
export function isPointInPolygon(point: Point, polygon: Polygon): boolean {
  if (polygon.length === 0) return false;
  const outer = polygon[0]!;
  if (!isPointInRing(point, outer)) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (isPointInRing(point, polygon[i]!)) return false;
  }
  return true;
}

function isPointInRing(point: Point, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const xi = a[0];
    const yi = a[1];
    const xj = b[0];
    const yj = b[1];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

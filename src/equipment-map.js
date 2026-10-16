// Groups screen-near equipment without changing its persisted map coordinates.
export function groupEquipmentMarkers(points, { width = 1000, height = 700, cellSize = 52, selectedId = '' } = {}) {
  const horizontal = Number.isFinite(width) && width > 0 ? width : 1000;
  const vertical = Number.isFinite(height) && height > 0 ? height : 700;
  const size = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 52;
  const buckets = new Map();
  const seen = new Set();
  for (const point of points) {
    if (!point?.uid || seen.has(point.uid) || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) continue;
    seen.add(point.uid);
    const key = point.uid === selectedId ? 'selected:' + point.uid : Math.floor(point.x * horizontal / 100 / size) + ':' + Math.floor(point.y * vertical / 100 / size);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(point);
  }
  return [...buckets.entries()].map(([key, members]) => {
    const ordered = [...members].sort((a, b) => String(a.markerId || a.uid).localeCompare(String(b.markerId || b.uid)) || String(a.uid).localeCompare(String(b.uid)));
    return { key, x: ordered.reduce((sum, point) => sum + point.x, 0) / ordered.length,
      y: ordered.reduce((sum, point) => sum + point.y, 0) / ordered.length, points: ordered };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

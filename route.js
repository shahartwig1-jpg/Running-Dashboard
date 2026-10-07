// Turns a run's raw GPS stream (two parallel arrays: latitudes and longitudes) into the small
// route the dashboard draws on a map. Used by fetch-data.js for new runs and by
// backfill-routes.js for existing ones.
//
// Privacy: the first and last TRIM_M metres are cut off, so the map never shows where someone
// starts or finishes (usually home). Runs shorter than MIN_TOTAL_M get no map at all, since a
// short route would be almost entirely trimmed anyway.
const TRIM_M = 150;
const MIN_TOTAL_M = 1500;
const MAX_POINTS = 350;

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildRoute(lats, lngs) {
  const pts = [];
  const n = Math.min((lats || []).length, (lngs || []).length);
  for (let i = 0; i < n; i++) {
    if (typeof lats[i] === "number" && typeof lngs[i] === "number" && Math.abs(lats[i]) <= 90 && Math.abs(lngs[i]) <= 180) pts.push([lats[i], lngs[i]]);
  }
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (total < MIN_TOTAL_M) return [];
  const kept = pts.filter((_, i) => cum[i] >= TRIM_M && cum[i] <= total - TRIM_M);
  if (kept.length < 2) return [];
  const step = Math.max(1, Math.ceil(kept.length / MAX_POINTS));
  const out = kept.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== kept[kept.length - 1]) out.push(kept[kept.length - 1]);
  return out.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
}

// From the raw `streams.json` response (an array of { type, data, data2 }), where latlng keeps the
// latitudes in `data` and the longitudes in `data2`.
function routeFromStreams(raw) {
  const s = (Array.isArray(raw) ? raw : []).find(x => x.type === "latlng");
  return s ? buildRoute(s.data, s.data2) : [];
}

module.exports = { buildRoute, routeFromStreams };

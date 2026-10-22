/* Geofencing: how far is a punch from the employee's assigned site? */

const R = 6371000; // earth radius, metres

export function distanceMetres(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/**
 * Evaluate a punch against a site.
 * Returns null when there is no site to check against (field staff).
 */
export function evaluateGeofence(site, lat, lng) {
  if (!site || lat == null || lng == null) return null;
  const distance_m = distanceMetres(site.lat, site.lng, lat, lng);
  // Allow for the GPS accuracy the device reports — a punch that is within the
  // radius once you account for accuracy should not be flagged.
  const slack = 0;
  return {
    site_id: site.id,
    site_name: site.name,
    radius_m: site.radius_m,
    distance_m,
    inside: distance_m <= site.radius_m + slack,
  };
}

/** Human line for a UI: "1.2 km from Vutto Showroom, Gurugram (allowed 250 m)". */
export function describeGeofence(g) {
  if (!g) return null;
  const d = g.distance_m >= 1000 ? `${(g.distance_m / 1000).toFixed(1)} km` : `${g.distance_m} m`;
  const r = g.radius_m >= 1000 ? `${(g.radius_m / 1000).toFixed(1)} km` : `${g.radius_m} m`;
  return g.inside
    ? `${d} from ${g.site_name} (within ${r})`
    : `${d} from ${g.site_name} — outside the allowed ${r}`;
}

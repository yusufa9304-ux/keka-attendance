/* Fake-GPS heuristics.

   IMPORTANT AND HONEST: a web page cannot ask the operating system whether the
   location is mocked — that flag is not exposed to browsers. What we can do is
   look for the fingerprints that mock-location apps leave behind, and score
   them. Treat the result as a signal for a human to review, not as proof.

   The checks:
     1. accuracy of exactly 0 m            -> typical of mock providers
     2. accuracy under 3 m                 -> implausibly precise for a phone
     3. accuracy over 2 km                 -> a rough "fuzzed" location
     4. device clock far from server time  -> injected position with a stale stamp
     5. impossible travel between readings -> teleporting (e.g. > 150 km/h)
     6. identical coordinates every time   -> a fixed point being replayed

   A native app can read Android's isMock flag / iOS's simulated-location
   indicator and report it directly; that is the reliable way to do this.
*/

import { distanceMetres } from './geofence.js';

const W = { accZero: 40, accPerfect: 20, accRough: 15, clockDrift: 30, teleport: 40, frozen: 25 };

export function scoreSpoof({ lat, lng, accuracy, clientTs, prev = [], now = Date.now() }) {
  const flags = [];
  let score = 0;

  const acc = accuracy == null ? null : Number(accuracy);
  if (Number.isFinite(acc)) {
    if (acc === 0) { score += W.accZero; flags.push('reported accuracy of 0 m (typical of mock providers)'); }
    else if (acc < 3) { score += W.accPerfect; flags.push(`implausibly precise accuracy (${acc} m)`); }
    else if (acc > 2000) { score += W.accRough; flags.push(`very rough accuracy (${Math.round(acc)} m)`); }
  }

  if (clientTs) {
    const drift = Math.abs(Number(clientTs) - now) / 1000;
    if (Number.isFinite(drift) && drift > 60) {
      score += W.clockDrift;
      flags.push(`device clock is ${Math.round(drift)}s off the server`);
    }
  }

  const last = prev[0];
  if (last && last.lat != null && last.lng != null && last.captured_at) {
    const d = distanceMetres(last.lat, last.lng, lat, lng);
    const secs = Math.max(1, (now - new Date(last.captured_at).getTime()) / 1000);
    const kmh = (d / 1000) / (secs / 3600);
    if (d > 200 && kmh > 150) {
      score += W.teleport;
      flags.push(`impossible travel: ${(d / 1000).toFixed(1)} km in ${Math.max(1, Math.round(secs / 60))} min (~${Math.round(kmh)} km/h)`);
    }
  }

  const identical = prev.slice(0, 4).filter(
    (p) => p.lat != null && Math.abs(p.lat - lat) < 1e-5 && Math.abs(p.lng - lng) < 1e-5,
  ).length;
  if (identical >= 4) {
    score += W.frozen;
    flags.push('identical coordinates across 5+ readings');
  }

  score = Math.min(100, score);
  return { score, flags, suspected: score >= 50 };
}

export function parseFlags(json) {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
}

import express from 'express';
import { db, todayStr, dateRange, WORK, PING_INTERVAL_MINUTES } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { evaluateGeofence, describeGeofence } from '../geofence.js';
import { scoreSpoof, parseFlags } from '../spoof.js';

const router = express.Router();
router.use(requireAuth);

const MAX_PHOTO_CHARS = 400_000; // ~300 KB after base64 — a 400px selfie is far smaller

/** SQLite only binds numbers/strings/null — turn a boolean into 1/0. */
const bit = (v) => (v === null || v === undefined ? null : (v ? 1 : 0)); // ~300 KB after base64 — a 400px selfie is far smaller

/** The site an employee is expected to be at (null = field staff, no check). */
function siteForUser(userId) {
  return db.prepare(`
    SELECT s.* FROM users u JOIN sites s ON s.id = u.site_id
    WHERE u.id = ? AND s.active = 1
  `).get(userId) || null;
}

function recentPings(userId, date, limit = 6) {
  return db.prepare(`
    SELECT lat, lng, accuracy, captured_at FROM location_pings
    WHERE user_id = ? AND date = ? ORDER BY captured_at DESC LIMIT ?
  `).all(userId, date, limit);
}

/** Validate the location + selfie that a punch must carry. */
function readPunchProof(body) {
  const { lat, lng, accuracy, address, photo, ts } = body || {};
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) {
    return { error: 'Location is required to punch in or out. Allow location access and try again.' };
  }
  if (typeof photo !== 'string' || !photo.startsWith('data:image/')) {
    return { error: 'A photo is required to punch in or out.' };
  }
  if (photo.length > MAX_PHOTO_CHARS) {
    return { error: 'That photo is too large. Please try again.' };
  }
  return {
    value: {
      lat: la, lng: ln,
      accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
      address: typeof address === 'string' ? address.slice(0, 300) : null,
      photo,
      ts: Number.isFinite(Number(ts)) ? Number(ts) : null,
    },
  };
}

function getTodayRow(userId, date = todayStr()) {
  return db.prepare(`
    SELECT a.*, si.name AS in_site_name, so.name AS out_site_name
    FROM attendance a
    LEFT JOIN sites si ON si.id = a.in_site_id
    LEFT JOIN sites so ON so.id = a.out_site_id
    WHERE a.user_id = ? AND a.date = ?
  `).get(userId, date);
}

function withComputed(row) {
  if (!row) return null;
  const geo = (kind) => {
    const distance = kind === 'in' ? row.in_distance_m : row.out_distance_m;
    if (distance == null) return null;
    const inside = kind === 'in' ? row.in_inside : row.out_inside;
    const siteName = kind === 'in' ? row.in_site_name : row.out_site_name;
    return {
      inside: !!inside,
      distance_m: distance,
      site_name: siteName || null,
      text: describeGeofence({ inside: !!inside, distance_m: distance, site_name: siteName, radius_m: null }),
    };
  };
  const spoof = (kind) => {
    const score = (kind === 'in' ? row.in_spoof_score : row.out_spoof_score) || 0;
    const flags = parseFlags(kind === 'in' ? row.in_spoof_flags : row.out_spoof_flags);
    return { score, flags, suspected: score >= 50 };
  };
  return {
    ...row,
    worked_hours: row.worked_minutes ? +(row.worked_minutes / 60).toFixed(2) : 0,
    is_late: row.clock_in ? row.clock_in.slice(11, 16) > WORK.start : false,
    in_map_url: row.in_lat != null ? `https://www.google.com/maps?q=${row.in_lat},${row.in_lng}` : null,
    out_map_url: row.out_lat != null ? `https://www.google.com/maps?q=${row.out_lat},${row.out_lng}` : null,
    in_geofence: geo('in'),
    out_geofence: geo('out'),
    in_spoof: spoof('in'),
    out_spoof: spoof('out'),
  };
}

/* Today's status for the logged-in user */
router.get('/today', (req, res) => {
  const uid = req.session.user.id;
  const row = getTodayRow(uid);
  const pings = db.prepare('SELECT COUNT(*) AS n FROM location_pings WHERE user_id = ? AND date = ?')
    .get(uid, todayStr()).n;
  const site = siteForUser(uid);
  res.json({
    date: todayStr(),
    attendance: withComputed(row),
    pings,
    ping_interval_minutes: PING_INTERVAL_MINUTES,
    site: site ? { id: site.id, name: site.name, radius_m: site.radius_m } : null,
  });
});

router.post('/clock-in', (req, res) => {
  const uid = req.session.user.id;
  const date = todayStr();
  const now = new Date().toISOString();

  const proof = readPunchProof(req.body);
  if (proof.error) return res.status(400).json({ error: proof.error });
  const p = proof.value;

  let row = getTodayRow(uid, date);
  if (row?.clock_in) return res.status(409).json({ error: 'You have already clocked in today' });

  const site = siteForUser(uid);
  const geo = evaluateGeofence(site, p.lat, p.lng);
  const spoof = scoreSpoof({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, clientTs: p.ts, prev: recentPings(uid, date) });

  const cols = [p.lat, p.lng, p.accuracy, p.address, p.photo,
    geo?.site_id ?? null, geo?.distance_m ?? null, bit(geo?.inside),
    spoof.score, JSON.stringify(spoof.flags)];

  if (!row) {
    db.prepare(`
      INSERT INTO attendance (user_id, date, clock_in, status,
        in_lat, in_lng, in_accuracy, in_address, in_photo,
        in_site_id, in_distance_m, in_inside, in_spoof_score, in_spoof_flags)
      VALUES (?, ?, ?, 'present', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uid, date, now, ...cols);
  } else {
    db.prepare(`
      UPDATE attendance SET clock_in = ?, status = 'present', note = NULL,
        in_lat = ?, in_lng = ?, in_accuracy = ?, in_address = ?, in_photo = ?,
        in_site_id = ?, in_distance_m = ?, in_inside = ?, in_spoof_score = ?, in_spoof_flags = ?
      WHERE id = ?
    `).run(now, ...cols, row.id);
  }

  db.prepare(`
    INSERT INTO location_pings (user_id, date, lat, lng, accuracy, address, captured_at, source, distance_m, inside, spoof_score, spoof_flags)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'punch', ?, ?, ?, ?)
  `).run(uid, date, p.lat, p.lng, p.accuracy, p.address, now,
    geo?.distance_m ?? null, bit(geo?.inside), spoof.score, JSON.stringify(spoof.flags));

  res.json({
    attendance: withComputed(getTodayRow(uid, date)),
    geofence: geo ? { ...geo, text: describeGeofence(geo) } : null,
    spoof,
  });
});

router.post('/clock-out', (req, res) => {
  const uid = req.session.user.id;
  const date = todayStr();
  const row = getTodayRow(uid, date);
  if (!row?.clock_in) return res.status(409).json({ error: 'You need to clock in first' });
  if (row.clock_out) return res.status(409).json({ error: 'You have already clocked out today' });

  const proof = readPunchProof(req.body);
  if (proof.error) return res.status(400).json({ error: proof.error });
  const p = proof.value;

  const now = new Date();
  const clockOut = now.toISOString();
  const worked = Math.max(0, Math.round((now - new Date(row.clock_in)) / 60000));
  const status = worked < WORK.halfDayMinutes ? 'half_day' : 'present';

  const site = siteForUser(uid);
  const geo = evaluateGeofence(site, p.lat, p.lng);
  const spoof = scoreSpoof({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, clientTs: p.ts, prev: recentPings(uid, date) });

  db.prepare(`
    UPDATE attendance SET clock_out = ?, worked_minutes = ?, status = ?,
      out_lat = ?, out_lng = ?, out_accuracy = ?, out_address = ?, out_photo = ?,
      out_site_id = ?, out_distance_m = ?, out_inside = ?, out_spoof_score = ?, out_spoof_flags = ?
    WHERE id = ?
  `).run(clockOut, worked, status, p.lat, p.lng, p.accuracy, p.address, p.photo,
    geo?.site_id ?? null, geo?.distance_m ?? null, bit(geo?.inside),
    spoof.score, JSON.stringify(spoof.flags), row.id);

  db.prepare(`
    INSERT INTO location_pings (user_id, date, lat, lng, accuracy, address, captured_at, source, distance_m, inside, spoof_score, spoof_flags)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'punch', ?, ?, ?, ?)
  `).run(uid, date, p.lat, p.lng, p.accuracy, p.address, clockOut,
    geo?.distance_m ?? null, bit(geo?.inside), spoof.score, JSON.stringify(spoof.flags));

  res.json({
    attendance: withComputed(getTodayRow(uid, date)),
    geofence: geo ? { ...geo, text: describeGeofence(geo) } : null,
    spoof,
  });
});

/* Periodic location update while on the clock (client sends every ~10 min). */
router.post('/ping', (req, res) => {
  const uid = req.session.user.id;
  const { lat, lng, accuracy, address, ts } = req.body || {};
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return res.status(400).json({ error: 'lat and lng are required' });

  const date = todayStr();
  const captured_at = new Date().toISOString();
  const site = siteForUser(uid);
  const geo = evaluateGeofence(site, la, ln);
  const spoof = scoreSpoof({ lat: la, lng: ln, accuracy, clientTs: ts, prev: recentPings(uid, date) });

  db.prepare(`
    INSERT INTO location_pings (user_id, date, lat, lng, accuracy, address, captured_at, source, distance_m, inside, spoof_score, spoof_flags)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', ?, ?, ?, ?)
  `).run(uid, date, la, ln, Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
    typeof address === 'string' ? address.slice(0, 300) : null, captured_at,
    geo?.distance_m ?? null, bit(geo?.inside), spoof.score, JSON.stringify(spoof.flags));

  res.json({ ok: true, captured_at, ping_interval_minutes: PING_INTERVAL_MINUTES, geofence: geo, spoof });
});

/* The employee's own location trail for a day. */
router.get('/trail', (req, res) => {
  const uid = req.session.user.id;
  const date = req.query.date || todayStr();
  const rows = db.prepare(`
    SELECT lat, lng, accuracy, address, captured_at, source, distance_m, inside, spoof_score, spoof_flags
    FROM location_pings WHERE user_id = ? AND date = ? ORDER BY captured_at
  `).all(uid, date);
  res.json({ date, pings: rows.map((p) => ({ ...p, spoof_flags: parseFlags(p.spoof_flags) })) });
});

/* History for the logged-in user */
router.get('/history', (req, res) => {
  const uid = req.session.user.id;
  const to = req.query.to || todayStr();
  const from = req.query.from
    || new Date(new Date(to + 'T00:00:00').getTime() - 29 * 864e5).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT a.*, si.name AS in_site_name, so.name AS out_site_name
    FROM attendance a
    LEFT JOIN sites si ON si.id = a.in_site_id
    LEFT JOIN sites so ON so.id = a.out_site_id
    WHERE a.user_id = ? AND a.date BETWEEN ? AND ? ORDER BY a.date DESC
  `).all(uid, from, to);
  res.json({ from, to, records: rows.map(withComputed) });
});

/* Monthly summary for the logged-in user */
router.get('/summary', (req, res) => {
  const uid = req.session.user.id;
  const month = req.query.month || todayStr().slice(0, 7); // YYYY-MM
  const rows = db.prepare(`SELECT * FROM attendance WHERE user_id = ? AND date LIKE ?`).all(uid, month + '%');
  const summary = {
    month,
    present: rows.filter((r) => r.status === 'present').length,
    half_day: rows.filter((r) => r.status === 'half_day').length,
    absent: rows.filter((r) => r.status === 'absent').length,
    on_leave: rows.filter((r) => r.status === 'on_leave').length,
    total_minutes: rows.reduce((a, r) => a + r.worked_minutes, 0),
    days_marked: rows.length,
  };
  summary.total_hours = +(summary.total_minutes / 60).toFixed(2);
  res.json(summary);
});

/* Regularization: ask an admin to fix a day's punches */
router.post('/regularize', (req, res) => {
  const uid = req.session.user.id;
  const { date, requested_clock_in, requested_clock_out, reason } = req.body || {};
  if (!date || !reason) return res.status(400).json({ error: 'date and reason are required' });

  const info = db.prepare(`
    INSERT INTO regularizations (user_id, date, requested_clock_in, requested_clock_out, reason, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(uid, date, requested_clock_in || null, requested_clock_out || null, reason);
  res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
});

router.get('/regularizations', (req, res) => {
  const uid = req.session.user.id;
  const rows = db.prepare('SELECT * FROM regularizations WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  res.json({ records: rows });
});

export { withComputed };
export default router;

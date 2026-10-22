import express from 'express';
import bcrypt from 'bcryptjs';
import { db, todayStr, dateRange, isWeekend, nextEmployeeCode, PING_INTERVAL_MINUTES } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { payrollMatrix, PAYROLL_COLUMNS } from '../payroll.js';
import { buildXlsx, buildCsv } from '../xlsx.js';
import { parseFlags } from '../spoof.js';

const router = express.Router();
router.use(requireAdmin);

const mapsUrl = (lat, lng) => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null);

/* ----------------------------- Dashboard ----------------------------- */

router.get('/dashboard', (_req, res) => {
  const date = todayStr();
  const totalEmployees = db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").get().n;

  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.department, u.employee_code, u.site_id, s.name AS site_name,
           a.clock_in, a.clock_out, a.status, a.worked_minutes,
           a.in_lat, a.in_lng, a.in_address, a.in_photo,
           a.out_lat, a.out_lng, a.out_address, a.out_photo,
           a.in_inside, a.in_distance_m, a.in_spoof_score, a.in_spoof_flags,
           a.out_inside, a.out_distance_m, a.out_spoof_score, a.out_spoof_flags
    FROM users u
    LEFT JOIN sites s ON s.id = u.site_id
    LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
    WHERE u.status = 'active' AND u.role = 'user'
    ORDER BY u.name
  `).all(date);

  const lastPing = db.prepare(`
    SELECT p.user_id, p.lat, p.lng, p.address, p.captured_at
    FROM location_pings p
    JOIN (SELECT user_id, MAX(captured_at) AS m FROM location_pings WHERE date = ? GROUP BY user_id) x
      ON x.user_id = p.user_id AND x.m = p.captured_at
    WHERE p.date = ?
  `).all(date, date);
  const pingByUser = Object.fromEntries(lastPing.map((p) => [p.user_id, p]));

  const team = rows.map((r) => {
    const lp = pingByUser[r.id] || null;
    return {
      ...r,
      worked_hours: r.worked_minutes ? +(r.worked_minutes / 60).toFixed(2) : 0,
      state: r.clock_in && !r.clock_out ? 'working' : r.clock_out ? 'done' : r.status === 'on_leave' ? 'on_leave' : 'not_in',
      in_map_url: mapsUrl(r.in_lat, r.in_lng),
      out_map_url: mapsUrl(r.out_lat, r.out_lng),
      last_seen: lp ? lp.captured_at : null,
      last_lat: lp ? lp.lat : null,
      last_lng: lp ? lp.lng : null,
      last_address: lp ? lp.address : null,
      last_map_url: lp ? mapsUrl(lp.lat, lp.lng) : null,
      pending_regularizations: 0,
      site_name: r.site_name || 'Field',
      in_inside: r.in_inside, in_distance_m: r.in_distance_m,
      out_inside: r.out_inside, out_distance_m: r.out_distance_m,
      spoof_score: Math.max(r.in_spoof_score || 0, r.out_spoof_score || 0),
      spoof_flags: [...new Set([...parseFlags(r.in_spoof_flags), ...parseFlags(r.out_spoof_flags)])],
      flagged: (r.in_spoof_score || 0) >= 50 || (r.out_spoof_score || 0) >= 50,
      outside: r.in_inside === 0 || r.out_inside === 0,
    };
  });

  const stats = {
    date,
    total_employees: totalEmployees,
    present: team.filter((t) => t.clock_in && t.status !== 'on_leave').length,
    working_now: team.filter((t) => t.state === 'working').length,
    absent: team.filter((t) => t.state === 'not_in').length,
    on_leave: team.filter((t) => t.status === 'on_leave').length,
  };

  const pendingLeaves = db.prepare("SELECT COUNT(*) AS n FROM leaves WHERE status = 'pending'").get().n;
  const pendingRegs = db.prepare("SELECT COUNT(*) AS n FROM regularizations WHERE status = 'pending'").get().n;

  // Per-employee pending regularization count, so the roster can flag it.
  const perUser = db.prepare("SELECT user_id, COUNT(*) AS n FROM regularizations WHERE status = 'pending' GROUP BY user_id").all();
  const pendingRegByUser = Object.fromEntries(perUser.map((r) => [r.user_id, r.n]));
  for (const t of team) t.pending_regularizations = pendingRegByUser[t.id] || 0;

  res.json({ stats, team, pending: { leaves: pendingLeaves, regularizations: pendingRegs }, ping_interval_minutes: PING_INTERVAL_MINUTES });
});

/* ----------------------------- Employees ----------------------------- */

function publicUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

router.get('/employees', (_req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY role DESC, name').all().map(publicUser);
  res.json({ employees: rows, next_employee_code: nextEmployeeCode() });
});

router.post('/employees', (req, res) => {
  const { name, email, password, role, department, leave_balance } = req.body || {};
  let { employee_code } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!['admin', 'user'].includes(role || 'user')) return res.status(400).json({ error: 'role must be admin or user' });
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  // Employee IDs are generated automatically when not supplied.
  if (!employee_code) employee_code = nextEmployeeCode();

  const info = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, department, employee_code, leave_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, email, bcrypt.hashSync(password, 10), role || 'user', department || null, employee_code, leave_balance ?? 18);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ employee: publicUser(u) });
});

router.patch('/employees/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  const { name, role, department, employee_code, status, leave_balance, password } = req.body || {};
  if (role && !['admin', 'user'].includes(role)) return res.status(400).json({ error: 'role must be admin or user' });
  if (status && !['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'status must be active or inactive' });

  // An admin must not be able to lock themselves out of the console.
  if (id === req.session.user.id) {
    if (role && role !== 'admin') return res.status(400).json({ error: "You can't change your own role. Ask another admin." });
    if (status && status !== 'active') return res.status(400).json({ error: "You can't deactivate your own account." });
  }

  db.prepare(`
    UPDATE users SET
      name = COALESCE(?, name),
      role = COALESCE(?, role),
      department = COALESCE(?, department),
      employee_code = COALESCE(?, employee_code),
      status = COALESCE(?, status),
      leave_balance = COALESCE(?, leave_balance),
      password_hash = COALESCE(?, password_hash)
    WHERE id = ?
  `).run(
    name ?? null, role ?? null, department ?? null, employee_code ?? null,
    status ?? null, leave_balance ?? null, password ? bcrypt.hashSync(password, 10) : null, id,
  );

  // Site assignment: a number assigns a showroom, null/'field' means field staff.
  if ('site_id' in (req.body || {})) {
    const raw = req.body.site_id;
    const siteId = raw === null || raw === '' || raw === 'field' ? null : Number(raw);
    if (siteId !== null && !db.prepare('SELECT 1 FROM sites WHERE id = ?').get(siteId)) {
      return res.status(400).json({ error: 'Unknown site' });
    }
    db.prepare('UPDATE users SET site_id = ? WHERE id = ?').run(siteId, id);
  }

  res.json({ employee: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

/* ----------------------------- Sites (geofences) ----------------------------- */

function siteRow(s) {
  return {
    ...s,
    active: !!s.active,
    map_url: mapsUrl(s.lat, s.lng),
    employees: db.prepare('SELECT COUNT(*) AS n FROM users WHERE site_id = ? AND role = \'user\'').get(s.id).n,
  };
}

router.get('/sites', (_req, res) => {
  const rows = db.prepare('SELECT * FROM sites ORDER BY name').all();
  res.json({ sites: rows.map(siteRow) });
});

router.post('/sites', (req, res) => {
  const { name, address, lat, lng, radius_m } = req.body || {};
  const la = Number(lat), ln = Number(lng);
  if (!name) return res.status(400).json({ error: 'A name is required' });
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return res.status(400).json({ error: 'Latitude and longitude are required' });
  const r = Number.isFinite(Number(radius_m)) && Number(radius_m) > 0 ? Math.round(Number(radius_m)) : 250;
  const info = db.prepare(`
    INSERT INTO sites (name, address, lat, lng, radius_m) VALUES (?, ?, ?, ?, ?)
  `).run(name, address || null, la, ln, r);
  res.status(201).json({ site: siteRow(db.prepare('SELECT * FROM sites WHERE id = ?').get(info.lastInsertRowid)) });
});

router.patch('/sites/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Site not found' });
  const { name, address, lat, lng, radius_m, active } = req.body || {};
  db.prepare(`
    UPDATE sites SET
      name = COALESCE(?, name), address = COALESCE(?, address),
      lat = COALESCE(?, lat), lng = COALESCE(?, lng),
      radius_m = COALESCE(?, radius_m), active = COALESCE(?, active)
    WHERE id = ?
  `).run(name ?? null, address ?? null,
    Number.isFinite(Number(lat)) ? Number(lat) : null,
    Number.isFinite(Number(lng)) ? Number(lng) : null,
    Number.isFinite(Number(radius_m)) ? Math.round(Number(radius_m)) : null,
    active === undefined ? null : (active ? 1 : 0), id);
  res.json({ site: siteRow(db.prepare('SELECT * FROM sites WHERE id = ?').get(id)) });
});

router.delete('/sites/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM sites WHERE id = ?').get(id)) return res.status(404).json({ error: 'Site not found' });
  db.prepare('UPDATE users SET site_id = NULL WHERE site_id = ?').run(id);
  db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ----------------------------- Payroll ----------------------------- */

router.get('/payroll', (req, res) => {
  const month = req.query.month || todayStr().slice(0, 7);
  const { columns, records } = payrollMatrix(month);
  res.json({ month, columns, records });
});

router.get('/payroll/export', (req, res) => {
  const month = req.query.month || todayStr().slice(0, 7);
  const format = (req.query.format || 'csv').toLowerCase();
  const { columns, rows } = payrollMatrix(month);
  const matrix = [columns, ...rows];
  const file = `vutto-payroll-${month}`;

  if (format === 'xlsx' || format === 'excel') {
    const bytes = buildXlsx(`Payroll ${month}`, matrix);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file}.xlsx"`);
    return res.end(Buffer.from(bytes));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file}.csv"`);
  res.end(buildCsv(matrix));
});

/* ----------------------------- Attendance ----------------------------- */

router.get('/attendance', (req, res) => {
  const { date, user_id, from, to } = req.query;
  const clauses = [];
  const params = [];
  if (date) { clauses.push('a.date = ?'); params.push(date); }
  if (from) { clauses.push('a.date >= ?'); params.push(from); }
  if (to) { clauses.push('a.date <= ?'); params.push(to); }
  if (user_id) { clauses.push('a.user_id = ?'); params.push(Number(user_id)); }

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT a.*, u.name AS employee_name, u.department, u.employee_code
    FROM attendance a JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.date DESC, u.name
    LIMIT 1000
  `).all(...params);
  res.json({
    records: rows.map((r) => ({
      ...r,
      worked_hours: r.worked_minutes ? +(r.worked_minutes / 60).toFixed(2) : 0,
      in_map_url: mapsUrl(r.in_lat, r.in_lng),
      out_map_url: mapsUrl(r.out_lat, r.out_lng),
    })),
  });
});

/* ----------------------------- Locations ----------------------------- */

/** Latest known location for every employee on the clock today. */
router.get('/locations', (req, res) => {
  const date = req.query.date || todayStr();

  const employees = db.prepare(`
    SELECT u.id, u.name, u.department, u.employee_code,
           a.clock_in, a.clock_out, a.status,
           a.in_lat, a.in_lng, a.in_address, a.in_photo,
           a.out_lat, a.out_lng, a.out_address, a.out_photo
    FROM users u
    LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
    WHERE u.status = 'active' AND u.role = 'user'
    ORDER BY u.name
  `).all(date);

  const pings = db.prepare(`
    SELECT id, user_id, lat, lng, accuracy, address, captured_at, source
    FROM location_pings WHERE date = ? ORDER BY captured_at DESC
  `).all(date);

  const byUser = {};
  for (const p of pings) (byUser[p.user_id] ||= []).push(p);

  const records = employees.map((e) => {
    const list = byUser[e.id] || [];
    const latest = list[0] || null;
    return {
      user_id: e.id,
      name: e.name,
      department: e.department,
      employee_code: e.employee_code,
      status: e.status,
      clock_in: e.clock_in,
      clock_out: e.clock_out,
      on_clock: !!e.clock_in && !e.clock_out,
      in_lat: e.in_lat, in_lng: e.in_lng, in_address: e.in_address, in_photo: e.in_photo,
      out_lat: e.out_lat, out_lng: e.out_lng, out_address: e.out_address, out_photo: e.out_photo,
      in_map_url: mapsUrl(e.in_lat, e.in_lng),
      out_map_url: mapsUrl(e.out_lat, e.out_lng),
      ping_count: list.length,
      last_seen: latest ? latest.captured_at : null,
      last_lat: latest ? latest.lat : null,
      last_lng: latest ? latest.lng : null,
      last_address: latest ? latest.address : null,
      last_map_url: latest ? mapsUrl(latest.lat, latest.lng) : null,
    };
  });

  res.json({ date, ping_interval_minutes: PING_INTERVAL_MINUTES, records });
});

/** Full location trail for one employee on a day. */
router.get('/locations/:userId/trail', (req, res) => {
  const date = req.query.date || todayStr();
  const rows = db.prepare(`
    SELECT lat, lng, accuracy, address, captured_at, source
    FROM location_pings WHERE user_id = ? AND date = ? ORDER BY captured_at
  `).all(Number(req.params.userId), date);
  res.json({ date, pings: rows.map((p) => ({ ...p, map_url: mapsUrl(p.lat, p.lng) })) });
});

/* ----------------------------- Leaves ----------------------------- */

router.get('/leaves', (req, res) => {
  const status = req.query.status;
  const where = status ? 'WHERE l.status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`
    SELECT l.*, u.name AS employee_name, u.department
    FROM leaves l JOIN users u ON u.id = l.user_id
    ${where}
    ORDER BY (l.status = 'pending') DESC, l.created_at DESC
  `).all(...params);
  res.json({ records: rows });
});

router.patch('/leaves/:id', (req, res) => {
  const id = Number(req.params.id);
  const action = req.body?.action;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });

  const leave = db.prepare('SELECT * FROM leaves WHERE id = ?').get(id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });
  if (leave.status !== 'pending') return res.status(409).json({ error: 'This request has already been reviewed' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  const tx = db.transaction(() => {
    db.prepare('UPDATE leaves SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\') WHERE id = ?')
      .run(status, req.session.user.id, id);

    if (status === 'approved') {
      if (leave.type !== 'unpaid') {
        db.prepare('UPDATE users SET leave_balance = leave_balance - ? WHERE id = ?').run(leave.days, leave.user_id);
      }
      const upsert = db.prepare(`
        INSERT INTO attendance (user_id, date, status, worked_minutes)
        VALUES (?, ?, 'on_leave', 0)
        ON CONFLICT(user_id, date) DO UPDATE SET status = 'on_leave', clock_in = NULL, clock_out = NULL, worked_minutes = 0
      `);
      for (const d of dateRange(leave.start_date, leave.end_date)) {
        if (!isWeekend(d)) upsert.run(leave.user_id, d);
      }
    }
  });
  tx();
  res.json({ ok: true, status });
});

/* ----------------------------- Regularizations ----------------------------- */

router.get('/regularizations', (req, res) => {
  const status = req.query.status;
  const where = status ? 'WHERE r.status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`
    SELECT r.*, u.name AS employee_name, u.department
    FROM regularizations r JOIN users u ON u.id = r.user_id
    ${where}
    ORDER BY (r.status = 'pending') DESC, r.created_at DESC
  `).all(...params);
  res.json({ records: rows });
});

router.patch('/regularizations/:id', (req, res) => {
  const id = Number(req.params.id);
  const action = req.body?.action;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });

  const reg = db.prepare('SELECT * FROM regularizations WHERE id = ?').get(id);
  if (!reg) return res.status(404).json({ error: 'Regularization not found' });
  if (reg.status !== 'pending') return res.status(409).json({ error: 'This request has already been reviewed' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  const tx = db.transaction(() => {
    db.prepare('UPDATE regularizations SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\') WHERE id = ?')
      .run(status, req.session.user.id, id);

    if (status === 'approved') {
      const worked = reg.requested_clock_in && reg.requested_clock_out
        ? Math.max(0, Math.round((new Date(reg.requested_clock_out) - new Date(reg.requested_clock_in)) / 60000))
        : 0;
      db.prepare(`
        INSERT INTO attendance (user_id, date, clock_in, clock_out, status, worked_minutes, note)
        VALUES (?, ?, ?, ?, 'present', ?, 'Regularized')
        ON CONFLICT(user_id, date) DO UPDATE SET
          clock_in = COALESCE(excluded.clock_in, attendance.clock_in),
          clock_out = COALESCE(excluded.clock_out, attendance.clock_out),
          worked_minutes = excluded.worked_minutes,
          status = 'present',
          note = 'Regularized'
      `).run(reg.user_id, reg.date, reg.requested_clock_in, reg.requested_clock_out, worked);
    }
  });
  tx();
  res.json({ ok: true, status });
});

/* ----------------------------- Reports ----------------------------- */

router.get('/reports/summary', (req, res) => {
  const month = req.query.month || todayStr().slice(0, 7);
  const rows = db.prepare(`
    SELECT u.id, u.name, u.department, u.employee_code,
           SUM(CASE WHEN a.status = 'present'   THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN a.status = 'half_day'  THEN 1 ELSE 0 END) AS half_day,
           SUM(CASE WHEN a.status = 'absent'    THEN 1 ELSE 0 END) AS absent,
           SUM(CASE WHEN a.status = 'on_leave'  THEN 1 ELSE 0 END) AS on_leave,
           COALESCE(SUM(a.worked_minutes), 0) AS total_minutes
    FROM users u
    LEFT JOIN attendance a ON a.user_id = u.id AND a.date LIKE ?
    WHERE u.role = 'user'
    GROUP BY u.id
    ORDER BY u.name
  `).all(month + '%');

  const records = rows.map((r) => ({ ...r, total_hours: +(r.total_minutes / 60).toFixed(2) }));
  const totals = records.reduce((acc, r) => ({
    present: acc.present + r.present,
    absent: acc.absent + r.absent,
    total_hours: +(acc.total_hours + r.total_hours).toFixed(2),
  }), { present: 0, absent: 0, total_hours: 0 });

  res.json({ month, records, totals });
});

export default router;

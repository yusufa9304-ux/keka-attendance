import express from 'express';
import bcrypt from 'bcryptjs';
import { db, todayStr, dateRange, isWeekend } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAdmin);

/* ----------------------------- Dashboard ----------------------------- */

router.get('/dashboard', (_req, res) => {
  const date = todayStr();
  const totalEmployees = db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").get().n;

  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.department, u.employee_code,
           a.clock_in, a.clock_out, a.status, a.worked_minutes
    FROM users u
    LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
    WHERE u.status = 'active' AND u.role = 'user'
    ORDER BY u.name
  `).all(date);

  const team = rows.map((r) => ({
    ...r,
    worked_hours: r.worked_minutes ? +(r.worked_minutes / 60).toFixed(2) : 0,
    state: r.clock_in && !r.clock_out ? 'working' : r.clock_out ? 'done' : r.status === 'on_leave' ? 'on_leave' : 'not_in',
  }));

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

  res.json({ stats, team, pending: { leaves: pendingLeaves, regularizations: pendingRegs } });
});

/* ----------------------------- Employees ----------------------------- */

function publicUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

router.get('/employees', (_req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY role DESC, name').all().map(publicUser);
  res.json({ employees: rows });
});

router.post('/employees', (req, res) => {
  const { name, email, password, role, department, employee_code, leave_balance } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!['admin', 'user'].includes(role || 'user')) return res.status(400).json({ error: 'role must be admin or user' });
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const info = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, department, employee_code, leave_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, email, bcrypt.hashSync(password, 10), role || 'user', department || null, employee_code || null, leave_balance ?? 18);
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
  res.json({ employee: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
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
  res.json({ records: rows.map((r) => ({ ...r, worked_hours: r.worked_minutes ? +(r.worked_minutes / 60).toFixed(2) : 0 })) });
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

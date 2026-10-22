import express from 'express';
import { db, todayStr, dateRange, WORK } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

function getTodayRow(userId, date = todayStr()) {
  return db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(userId, date);
}

function withComputed(row) {
  if (!row) return null;
  return {
    ...row,
    worked_hours: row.worked_minutes ? +(row.worked_minutes / 60).toFixed(2) : 0,
    is_late: row.clock_in ? row.clock_in.slice(11, 16) > WORK.start : false,
  };
}

/* Today's status for the logged-in user */
router.get('/today', (req, res) => {
  const row = getTodayRow(req.session.user.id);
  res.json({ date: todayStr(), attendance: withComputed(row) });
});

router.post('/clock-in', (req, res) => {
  const uid = req.session.user.id;
  const date = todayStr();
  const now = new Date().toISOString();

  let row = getTodayRow(uid, date);
  if (row?.clock_in) return res.status(409).json({ error: 'You have already clocked in today' });

  if (!row) {
    db.prepare(`INSERT INTO attendance (user_id, date, clock_in, status) VALUES (?, ?, ?, 'present')`).run(uid, date, now);
  } else {
    db.prepare(`UPDATE attendance SET clock_in = ?, status = 'present', note = NULL WHERE id = ?`).run(now, row.id);
  }
  res.json({ attendance: withComputed(getTodayRow(uid, date)) });
});

router.post('/clock-out', (req, res) => {
  const uid = req.session.user.id;
  const date = todayStr();
  const row = getTodayRow(uid, date);
  if (!row?.clock_in) return res.status(409).json({ error: 'You need to clock in first' });
  if (row.clock_out) return res.status(409).json({ error: 'You have already clocked out today' });

  const now = new Date();
  const clockOut = now.toISOString();
  const worked = Math.max(0, Math.round((now - new Date(row.clock_in)) / 60000));
  const status = worked < WORK.halfDayMinutes ? 'half_day' : 'present';

  db.prepare('UPDATE attendance SET clock_out = ?, worked_minutes = ?, status = ? WHERE id = ?')
    .run(clockOut, worked, status, row.id);
  res.json({ attendance: withComputed(getTodayRow(uid, date)) });
});

/* History for the logged-in user */
router.get('/history', (req, res) => {
  const uid = req.session.user.id;
  const to = req.query.to || todayStr();
  const from = req.query.from
    || new Date(new Date(to + 'T00:00:00').getTime() - 29 * 864e5).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC
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

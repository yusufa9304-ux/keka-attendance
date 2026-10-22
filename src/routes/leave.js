import express from 'express';
import { db, dateRange, isWeekend } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

const TYPES = [
  { id: 'casual', label: 'Casual Leave' },
  { id: 'sick', label: 'Sick Leave' },
  { id: 'earned', label: 'Earned Leave' },
  { id: 'unpaid', label: 'Loss of Pay' },
];

/** Counts working days (skips weekends) between two dates, inclusive. */
function workingDays(start, end) {
  return dateRange(start, end).filter((d) => !isWeekend(d)).length || 1;
}

function usedThisYear(userId) {
  const year = new Date().getFullYear();
  const rows = db.prepare(`
    SELECT days FROM leaves
    WHERE user_id = ? AND status = 'approved' AND type != 'unpaid'
      AND substr(start_date, 1, 4) = ?
  `).all(userId, String(year));
  return rows.reduce((a, r) => a + r.days, 0);
}

router.get('/types', (_req, res) => res.json({ types: TYPES }));

router.get('/balance', (req, res) => {
  const uid = req.session.user.id;
  const u = db.prepare('SELECT leave_balance FROM users WHERE id = ?').get(uid);
  const used = usedThisYear(uid);
  res.json({
    entitlement: u.leave_balance,
    used,
    remaining: +(u.leave_balance - used).toFixed(1),
  });
});

router.post('/', (req, res) => {
  const uid = req.session.user.id;
  const { type, start_date, end_date, reason } = req.body || {};
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date are required' });
  if (end_date < start_date) return res.status(400).json({ error: 'end_date cannot be before start_date' });
  if (!TYPES.some((t) => t.id === type)) return res.status(400).json({ error: 'Unknown leave type' });

  const days = workingDays(start_date, end_date);
  const info = db.prepare(`
    INSERT INTO leaves (user_id, type, start_date, end_date, days, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(uid, type, start_date, end_date, days, reason || null);
  res.status(201).json({ id: info.lastInsertRowid, days, status: 'pending' });
});

router.get('/mine', (req, res) => {
  const uid = req.session.user.id;
  const rows = db.prepare('SELECT * FROM leaves WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  res.json({ records: rows });
});

router.delete('/:id', (req, res) => {
  const uid = req.session.user.id;
  const row = db.prepare('SELECT * FROM leaves WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!row) return res.status(404).json({ error: 'Leave request not found' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be cancelled' });
  db.prepare('DELETE FROM leaves WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

export default router;

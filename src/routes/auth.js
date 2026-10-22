import express from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';

const router = express.Router();

/**
 * What the client is allowed to know about a user. Reporting-line fields are
 * computed here so every screen agrees on who is a manager.
 */
export function publicUser(u) {
  const reports = db.prepare("SELECT COUNT(*) AS n FROM users WHERE manager_id = ? AND status = 'active'").get(u.id).n;
  const mgr = u.manager_id
    ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(u.manager_id)
    : null;
  const isAdminUser = u.role === 'admin';
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department,
    employee_code: u.employee_code,
    status: u.status,
    leave_balance: u.leave_balance,
    site_id: u.site_id ?? null,
    // reporting line
    manager_id: u.manager_id ?? null,
    manager_name: mgr ? mgr.name : null,
    reports,
    is_manager: !isAdminUser && reports > 0,
    // may this person open the team console at all?
    can_console: isAdminUser || reports > 0,
  };
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'This account has been deactivated. Contact your admin.' });
  }

  req.session.user = publicUser(user);
  res.json({ user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  // Refresh from DB so role/status/reporting-line changes take effect.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.session.user = publicUser(user);
  res.json({ user: req.session.user });
});

export default router;

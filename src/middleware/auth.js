/** Session guards used by the route modules. */

import { isManager, isAdmin } from '../team.js';

export function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!isAdmin(req.session.user)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

/** Admin console access: full admins, and reporting managers for their own team. */
export function requireConsole(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!isAdmin(req.session.user) && !isManager(req.session.user)) {
    return res.status(403).json({ error: 'Manager or admin access required' });
  }
  next();
}

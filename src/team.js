/* Reporting lines.
 *
 * There is no separate "manager" role. A manager is simply somebody who has
 * people reporting to them, recorded as users.manager_id — so a manager is
 * still an ordinary employee who punches in and out like everyone else.
 *
 * Scope rules, in one place so every route agrees:
 *   admin    -> sees everyone
 *   manager  -> sees their direct reports (and nobody else)
 *   employee -> sees only themselves
 */

import { db } from './db.js';

export const isAdmin = (user) => user?.role === 'admin';

/** Ids of the people who report directly to this user. */
export function directReportIds(managerId) {
  return db.prepare('SELECT id FROM users WHERE manager_id = ? AND status = \'active\'')
    .all(managerId).map((r) => r.id);
}

export const isManager = (user) => !!user && !isAdmin(user) && directReportIds(user.id).length > 0;

/**
 * The user ids a console viewer is allowed to see.
 * `null` means "everyone" (an admin). An array means "exactly these".
 */
export function visibleUserIds(user) {
  if (isAdmin(user)) return null;
  return directReportIds(user.id);
}

/** Can this viewer approve/handle something belonging to `targetUserId`? */
export function canActFor(user, targetUserId) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (user.id === targetUserId) return false;      // nobody approves their own request
  return directReportIds(user.id).includes(targetUserId);
}

/** A SQL fragment + params that limits a query to what `user` may see. */
export function scopeClause(user, column = 'user_id') {
  const ids = visibleUserIds(user);
  if (ids === null) return { sql: '', params: [] };
  if (!ids.length) return { sql: ` AND 1 = 0`, params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** The manager a person reports to, as a small object for the UI. */
export function managerOf(userId) {
  const m = db.prepare(`
    SELECT m.id, m.name, m.email FROM users u
    JOIN users m ON m.id = u.manager_id
    WHERE u.id = ?
  `).get(userId);
  return m || null;
}

/* Payroll-ready monthly figures, per employee. */

import { db, dateRange, isWeekend } from './db.js';

export const PAYROLL_COLUMNS = [
  'Employee Code', 'Employee', 'Department', 'Site',
  'Present', 'Half days', 'Absent', 'Paid leave', 'Unpaid leave (LOP)',
  'Payable days', 'Worked hours', 'Overtime hours', 'Late marks',
  'Outside geofence', 'GPS flags',
];

const FULL_DAY_MINUTES = 480;

/** Approved unpaid-leave days that fall inside `month`, per user. */
function unpaidLeaveDays(month) {
  const rows = db.prepare(`
    SELECT user_id, start_date, end_date FROM leaves
    WHERE status = 'approved' AND type = 'unpaid' AND start_date <= ? AND end_date >= ?
  `).all(month + '-31', month + '-01');

  const out = {};
  for (const r of rows) {
    const days = dateRange(r.start_date, r.end_date)
      .filter((d) => d.startsWith(month) && !isWeekend(d)).length;
    out[r.user_id] = (out[r.user_id] || 0) + days;
  }
  return out;
}

export function payrollRows(month) {
  const users = db.prepare(`
    SELECT u.id, u.name, u.employee_code, u.department, s.name AS site_name
    FROM users u LEFT JOIN sites s ON s.id = u.site_id
    WHERE u.role = 'user'
    ORDER BY u.name
  `).all();

  const att = db.prepare(`
    SELECT * FROM attendance WHERE date LIKE ? AND user_id IN (SELECT id FROM users WHERE role = 'user')
  `).all(month + '%');

  const unpaid = unpaidLeaveDays(month);

  const byUser = {};
  for (const a of att) (byUser[a.user_id] ||= []).push(a);

  return users.map((u) => {
    const rows = byUser[u.id] || [];
    const count = (fn) => rows.filter(fn).length;

    const present = count((r) => r.status === 'present');
    const half = count((r) => r.status === 'half_day');
    const absent = count((r) => r.status === 'absent');
    const onLeave = count((r) => r.status === 'on_leave');

    const lopDays = unpaid[u.id] || 0;
    const paidLeave = Math.max(0, onLeave - lopDays);

    const totalMinutes = rows.reduce((a, r) => a + (r.worked_minutes || 0), 0);
    const overtimeMinutes = rows.reduce((a, r) => a + Math.max(0, (r.worked_minutes || 0) - FULL_DAY_MINUTES), 0);

    const late = rows.filter((r) => r.clock_in && r.clock_in.slice(11, 16) > '09:30').length;
    const outside = rows.filter((r) => r.in_inside === 0 || r.out_inside === 0).length;
    const flagged = rows.filter((r) => (r.in_spoof_score || 0) >= 50 || (r.out_spoof_score || 0) >= 50).length;

    const payable = present + half * 0.5 + paidLeave;

    return {
      user_id: u.id,
      employee_code: u.employee_code || '',
      name: u.name,
      department: u.department || '',
      site: u.site_name || 'Field',
      present,
      half_days: half,
      absent,
      paid_leave: paidLeave,
      unpaid_leave: lopDays,
      payable_days: +payable.toFixed(1),
      worked_hours: +(totalMinutes / 60).toFixed(2),
      overtime_hours: +(overtimeMinutes / 60).toFixed(2),
      late_marks: late,
      outside_geofence: outside,
      gps_flags: flagged,
    };
  });
}

/** Rows in the same order as PAYROLL_COLUMNS, ready for CSV/XLSX. */
export function payrollMatrix(month) {
  const rows = payrollRows(month);
  const body = rows.map((r) => [
    r.employee_code, r.name, r.department, r.site,
    r.present, r.half_days, r.absent, r.paid_leave, r.unpaid_leave,
    r.payable_days, r.worked_hours, r.overtime_hours, r.late_marks,
    r.outside_geofence, r.gps_flags,
  ]);
  return { columns: PAYROLL_COLUMNS, rows: body, records: rows };
}

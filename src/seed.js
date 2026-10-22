import bcrypt from 'bcryptjs';
import { db, todayStr, addDays, isWeekend } from './db.js';

/**
 * Seeds the database with one admin and a handful of employees, plus some
 * attendance history and a couple of pending requests so the dashboards
 * have something to show. Run with `--reset` to wipe first.
 */

const RESET = process.argv.includes('--reset');

if (RESET) {
  db.exec('DELETE FROM regularizations; DELETE FROM leaves; DELETE FROM attendance; DELETE FROM users;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','attendance','leaves','regularizations');");
}

const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (count > 0) {
  console.log(`Database already has ${count} users. Use "npm run reset" to reseed from scratch.`);
  process.exit(0);
}

const hash = (pw) => bcrypt.hashSync(pw, 10);

const insertUser = db.prepare(`
  INSERT INTO users (name, email, password_hash, role, department, employee_code, leave_balance)
  VALUES (@name, @email, @password_hash, @role, @department, @employee_code, @leave_balance)
`);

const seedUsers = [
  { name: 'Yusuf Admin',   email: 'admin@keka.demo',  password: 'Admin@123', role: 'admin', department: 'HR',        employee_code: 'KKA-0001', leave_balance: 18 },
  { name: 'Aarav Sharma',  email: 'aarav@keka.demo',  password: 'User@123',  role: 'user',  department: 'Engineering', employee_code: 'KKA-0002', leave_balance: 14 },
  { name: 'Priya Nair',    email: 'priya@keka.demo',  password: 'User@123',  role: 'user',  department: 'Design',      employee_code: 'KKA-0003', leave_balance: 16 },
  { name: 'Rahul Verma',   email: 'rahul@keka.demo',  password: 'User@123',  role: 'user',  department: 'Sales',       employee_code: 'KKA-0004', leave_balance: 12 },
  { name: 'Sneha Iyer',    email: 'sneha@keka.demo',  password: 'User@123',  role: 'user',  department: 'Engineering', employee_code: 'KKA-0005', leave_balance: 18 },
];

const ids = {};
const tx = db.transaction(() => {
  for (const u of seedUsers) {
    const info = insertUser.run({ ...u, password_hash: hash(u.password) });
    ids[u.email] = info.lastInsertRowid;
  }

  // ~14 days of attendance history for each employee (skip weekends).
  const insertAtt = db.prepare(`
    INSERT OR IGNORE INTO attendance (user_id, date, clock_in, clock_out, status, worked_minutes, note)
    VALUES (@user_id, @date, @clock_in, @clock_out, @status, @worked_minutes, @note)
  `);
  const employees = seedUsers.filter((u) => u.role === 'user');
  const today = todayStr();
  for (let back = 14; back >= 0; back--) {
    const date = addDays(today, -back);
    if (isWeekend(date)) continue;
    for (const [i, e] of employees.entries()) {
      const uid = ids[e.email];
      // leave one person absent a few days ago, and give one a half day.
      const absent = back === 6 && i === 2;
      const half = back === 3 && i === 1;
      if (absent) {
        insertAtt.run({ user_id: uid, date, clock_in: null, clock_out: null, status: 'absent', worked_minutes: 0, note: 'No show' });
        continue;
      }
      const isToday = back === 0;
      if (isToday && i === 0) continue; // one employee stays unpunched so clock-in can be demoed
      const inH = 9 + (i % 2);
      const inM = (i * 7) % 40;
      const clockIn = `${date}T${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00`;
      const outH = half ? 13 : 18;
      const outM = half ? 30 : 15 + ((i * 5) % 30);
      const clockOut = isToday ? null : `${date}T${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}:00`;
      const worked = isToday ? 0 : (outH * 60 + outM) - (inH * 60 + inM);
      insertAtt.run({
        user_id: uid,
        date,
        clock_in: clockIn,
        clock_out: clockOut,
        status: isToday ? 'present' : half ? 'half_day' : 'present',
        worked_minutes: worked,
        note: null,
      });
    }
  }

  // A couple of pending leave requests.
  const insertLeave = db.prepare(`
    INSERT INTO leaves (user_id, type, start_date, end_date, days, reason, status)
    VALUES (@user_id, @type, @start_date, @end_date, @days, @reason, @status)
  `);
  insertLeave.run({ user_id: ids['aarav@keka.demo'], type: 'casual', start_date: addDays(today, 3), end_date: addDays(today, 4), days: 2, reason: 'Family function out of town', status: 'pending' });
  insertLeave.run({ user_id: ids['priya@keka.demo'], type: 'sick', start_date: addDays(today, 1), end_date: addDays(today, 1), days: 1, reason: 'Fever, doctor advised rest', status: 'pending' });

  // A pending regularization request.
  db.prepare(`
    INSERT INTO regularizations (user_id, date, requested_clock_in, requested_clock_out, reason, status)
    VALUES (@user_id, @date, @in, @out, @reason, 'pending')
  `).run({
    user_id: ids['rahul@keka.demo'],
    date: addDays(today, -2),
    in: `${addDays(today, -2)}T09:35:00`,
    out: `${addDays(today, -2)}T18:40:00`,
    reason: 'Forgot to clock out, was on client call',
  });
});

tx();
console.log('Seed complete.');
console.log('  Admin : admin@keka.demo  / Admin@123');
console.log('  User  : aarav@keka.demo  / User@123  (also priya/rahul/sneha @keka.demo)');

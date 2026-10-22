import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { db, todayStr, addDays, isWeekend } from './db.js';

/**
 * Seeds the database with one admin and a handful of employees, plus some
 * attendance history and a couple of pending requests so the dashboards
 * have something to show.
 *
 * Run as a script (`npm run seed`) or call seedIfEmpty() from the server so a
 * fresh deployment initialises itself on first boot.
 */

export function runSeed({ reset = false, quiet = false } = {}) {
  if (reset) {
    db.exec('DELETE FROM regularizations; DELETE FROM leaves; DELETE FROM attendance; DELETE FROM users;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','attendance','leaves','regularizations');");
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) {
    if (!quiet) console.log(`Database already has ${count} users. Use "npm run reset" to reseed from scratch.`);
    return false;
  }

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, department, employee_code, leave_balance)
    VALUES (@name, @email, @password_hash, @role, @department, @employee_code, @leave_balance)
  `);

  const seedUsers = [
    { name: 'Yusuf Admin',   email: 'admin@vutto.demo',  password: 'Admin@123', role: 'admin', department: 'HR',        employee_code: 'VUT-0001', leave_balance: 18 },
    { name: 'Aarav Sharma',  email: 'aarav@vutto.demo',  password: 'User@123',  role: 'user',  department: 'Engineering', employee_code: 'VUT-0002', leave_balance: 14 },
    { name: 'Priya Nair',    email: 'priya@vutto.demo',  password: 'User@123',  role: 'user',  department: 'Design',      employee_code: 'VUT-0003', leave_balance: 16 },
    { name: 'Rahul Verma',   email: 'rahul@vutto.demo',  password: 'User@123',  role: 'user',  department: 'Sales',       employee_code: 'VUT-0004', leave_balance: 12 },
    { name: 'Sneha Iyer',    email: 'sneha@vutto.demo',  password: 'User@123',  role: 'user',  department: 'Engineering', employee_code: 'VUT-0005', leave_balance: 18 },
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
    insertLeave.run({ user_id: ids['aarav@vutto.demo'], type: 'casual', start_date: addDays(today, 3), end_date: addDays(today, 4), days: 2, reason: 'Family function out of town', status: 'pending' });
    insertLeave.run({ user_id: ids['priya@vutto.demo'], type: 'sick', start_date: addDays(today, 1), end_date: addDays(today, 1), days: 1, reason: 'Fever, doctor advised rest', status: 'pending' });

    // A pending regularization request.
    db.prepare(`
      INSERT INTO regularizations (user_id, date, requested_clock_in, requested_clock_out, reason, status)
      VALUES (@user_id, @date, @in, @out, @reason, 'pending')
    `).run({
      user_id: ids['rahul@vutto.demo'],
      date: addDays(today, -2),
      in: `${addDays(today, -2)}T09:35:00`,
      out: `${addDays(today, -2)}T18:40:00`,
      reason: 'Forgot to clock out, was on client call',
    });
  });

  tx();
  if (!quiet) {
    console.log('Seed complete.');
    console.log('  Admin : admin@vutto.demo  / Admin@123');
    console.log('  User  : aarav@vutto.demo  / User@123  (also priya/rahul/sneha @vutto.demo)');
  }
  return true;
}

/** Called on server boot so a fresh deployment has data to log in with. */
export function seedIfEmpty() {
  try {
    const seeded = runSeed({ quiet: true });
    if (seeded) console.log('First boot: demo data seeded (admin@vutto.demo / Admin@123).');
  } catch (err) {
    console.error('Auto-seed skipped:', err.message);
  }
}

// Run as a CLI when invoked directly: `node src/seed.js [--reset]`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed({ reset: process.argv.includes('--reset') });
}

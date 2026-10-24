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
    db.exec('DELETE FROM location_pings; DELETE FROM regularizations; DELETE FROM leaves; DELETE FROM attendance; DELETE FROM users; DELETE FROM sites;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','attendance','leaves','regularizations','location_pings','sites');");
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) {
    if (!quiet) console.log(`Database already has ${count} users. Use "npm run reset" to reseed from scratch.`);
    return false;
  }

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  // Vutto showrooms — the geofences employees are checked against.
  const siteList = [
    { name: 'Vutto Showroom — Connaught Place', address: 'Connaught Place, New Delhi', lat: 28.6139, lng: 77.2090, radius_m: 250 },
    { name: 'Vutto Showroom — Noida', address: 'Sector 62, Noida', lat: 28.5355, lng: 77.3910, radius_m: 300 },
    { name: 'Vutto Showroom — Gurugram', address: 'Sector 29, Gurugram', lat: 28.4595, lng: 77.0266, radius_m: 300 },
    { name: 'Vutto Hub — Ghaziabad', address: 'Vaishali, Ghaziabad', lat: 28.6692, lng: 77.4538, radius_m: 200 },
    { name: 'Vutto Yard — Dwarka', address: 'Dwarka, New Delhi', lat: 28.5921, lng: 77.0460, radius_m: 400 },
  ];
  const insertSite = db.prepare('INSERT INTO sites (name, address, lat, lng, radius_m) VALUES (@name, @address, @lat, @lng, @radius_m)');
  const siteIds = siteList.map((s) => insertSite.run(s).lastInsertRowid);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, department, employee_code, leave_balance, site_id)
    VALUES (@name, @email, @password_hash, @role, @department, @employee_code, @leave_balance, @site_id)
  `);

  const seedUsers = [
    { name: 'Yusuf Admin',   email: 'admin@vutto.demo',  password: 'Admin@123', role: 'admin', department: 'HR',        employee_code: 'VUT-0001', leave_balance: 18, site_id: siteIds[0] },
    { name: 'Aarav Sharma',  email: 'aarav@vutto.demo',  password: 'User@123',  role: 'user',  department: 'Sales',       employee_code: 'VUT-0002', leave_balance: 14, site_id: siteIds[0] },
    { name: 'Priya Nair',    email: 'priya@vutto.demo',  password: 'User@123',  role: 'user',  department: 'Sales',       employee_code: 'VUT-0003', leave_balance: 16, site_id: siteIds[1] },
    { name: 'Rahul Verma',   email: 'rahul@vutto.demo',  password: 'User@123',  role: 'user',  department: 'Field Sales', employee_code: 'VUT-0004', leave_balance: 12, site_id: null }, // field staff: no geofence
    { name: 'Sneha Iyer',    email: 'sneha@vutto.demo',  password: 'User@123',  role: 'user',  department: 'Refurb',      employee_code: 'VUT-0005', leave_balance: 18, site_id: siteIds[2] },
  ];

  const ids = {};

  // Reporting lines: a small tree, so the manager view has something to show.
  //   Yusuf Admin  ->  Aarav, Priya
  //   Aarav        ->  Priya, Rahul
  //   Priya        ->  Sneha
  const reportTo = {
    'aarav@vutto.demo': 'admin@vutto.demo',
    'priya@vutto.demo': 'aarav@vutto.demo',
    'rahul@vutto.demo': 'aarav@vutto.demo',
    'sneha@vutto.demo': 'priya@vutto.demo',
  };
  const tx = db.transaction(() => {
    for (const u of seedUsers) {
      const info = insertUser.run({ ...u, password_hash: hash(u.password) });
      ids[u.email] = info.lastInsertRowid;
    }

    // ~14 days of attendance history for each employee (skip weekends).
    // Office / site coordinates so the location features have demo data.
    const SITES = [
      { lat: 28.6139, lng: 77.2090, address: 'Connaught Place, New Delhi' },
      { lat: 28.5355, lng: 77.3910, address: 'Sector 62, Noida' },
      { lat: 28.4595, lng: 77.0266, address: 'Sector 29, Gurugram' },
      { lat: 28.6692, lng: 77.4538, address: 'Vaishali, Ghaziabad' },
      { lat: 28.5921, lng: 77.0460, address: 'Dwarka, New Delhi' },
    ];
    const insertAtt = db.prepare(`
      INSERT OR IGNORE INTO attendance
        (user_id, date, clock_in, clock_out, status, worked_minutes, note, in_lat, in_lng, in_address,
         in_site_id, in_distance_m, in_inside, in_spoof_score, in_spoof_flags)
      VALUES
        (@user_id, @date, @clock_in, @clock_out, @status, @worked_minutes, @note, @in_lat, @in_lng, @in_address,
         @in_site_id, @in_distance_m, @in_inside, @in_spoof_score, @in_spoof_flags)
    `);
    const employees = seedUsers.filter((u) => u.role === 'user');
    const today = todayStr();
    let dayIdx = -1; // counts working days only, so demo flags never land on a weekend
    for (let back = 14; back >= 0; back--) {
      const date = addDays(today, -back);
      // Keep today even when it is a weekend. Skipping it left the demo with an
      // empty Team Today on Saturdays and Sundays, which reads as a broken app
      // rather than a quiet day.
      if (isWeekend(date) && back !== 0) continue;
      dayIdx++;
      for (const [i, e] of employees.entries()) {
        const uid = ids[e.email];
        const absent = back === 6 && i === 2;
        const half = back === 3 && i === 1;
        if (absent) {
          insertAtt.run({ user_id: uid, date, clock_in: null, clock_out: null, status: 'absent', worked_minutes: 0, note: 'No show', in_lat: null, in_lng: null, in_address: null, in_site_id: null, in_distance_m: null, in_inside: null, in_spoof_score: 0, in_spoof_flags: '[]' });
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
        const site = SITES[i % SITES.length];
        // Demo flavour: one day a punch lands outside the geofence, and one day
        // carries a mock-location fingerprint, so the admin view has examples.
        const offsite = dayIdx === 6 && i === 1;
        const spoofed = dayIdx === 9 && i === 2;
        const inDistance = offsite ? 1840 : 30 + ((i * 17) % 90);
        const inInside = e.site_id == null ? null : (offsite ? 0 : 1);
        insertAtt.run({
          user_id: uid,
          date,
          clock_in: clockIn,
          clock_out: clockOut,
          status: isToday ? 'present' : half ? 'half_day' : 'present',
          worked_minutes: worked,
          note: null,
          in_lat: site.lat,
          in_lng: site.lng,
          in_address: site.address,
          in_site_id: e.site_id || null,
          in_distance_m: e.site_id == null ? null : inDistance,
          in_inside: inInside,
          in_spoof_score: spoofed ? 70 : 0,
          in_spoof_flags: spoofed ? JSON.stringify(['reported accuracy of 0 m (typical of mock providers)', 'identical coordinates across 5+ readings']) : '[]',
        });
        // A short location trail for today's punches (every ~10 min).
        if (isToday) {
          const ping = db.prepare(`
            INSERT INTO location_pings (user_id, date, lat, lng, accuracy, address, captured_at, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'auto')
          `);
          for (let k = 1; k <= 3; k++) {
            const t = `${date}T${String(10 + k).padStart(2, '0')}:${String((i * 7 + k * 3) % 60).padStart(2, '0')}:00`;
            ping.run(uid, date, site.lat + k * 0.0012, site.lng + k * 0.0009, 18 + k, site.address, t);
          }
        }
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

  // Reporting lines are set after the users exist (a manager_id points at a
  // row created in the same run).
  const setManager = db.prepare('UPDATE users SET manager_id = ? WHERE email = ?');
  for (const [email, mgr] of Object.entries(reportTo)) setManager.run(ids[mgr], email);

  if (!quiet) {
    console.log('Seed complete.');
    console.log('  Admin : admin@vutto.demo  / Admin@123');
    console.log('  User  : aarav@vutto.demo  / User@123  (also priya/rahul/sneha @vutto.demo)');
    console.log('  Managers: aarav (manages priya, rahul) · priya (manages sneha)');
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

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbFile = process.env.DB_FILE || path.join(dataDir, 'attendance.db');
export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  role           TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  department     TEXT,
  employee_code  TEXT,
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  leave_balance  REAL    NOT NULL DEFAULT 18,
  -- who this person reports to; anyone who has reports is a reporting manager
  manager_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  address     TEXT,
  lat         REAL    NOT NULL,
  lng         REAL    NOT NULL,
  radius_m    INTEGER NOT NULL DEFAULT 250,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date           TEXT    NOT NULL,               -- YYYY-MM-DD
  clock_in       TEXT,                           -- ISO timestamp
  clock_out      TEXT,                           -- ISO timestamp
  status         TEXT    NOT NULL DEFAULT 'present'
                 CHECK (status IN ('present','half_day','absent','on_leave','weekly_off','holiday')),
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  -- punch-time location + selfie (photo is a data URL)
  in_lat REAL, in_lng REAL, in_accuracy REAL, in_address TEXT, in_photo TEXT,
  out_lat REAL, out_lng REAL, out_accuracy REAL, out_address TEXT, out_photo TEXT,
  -- geofence result at punch time (distance from the employee's assigned site)
  in_site_id INTEGER, in_distance_m REAL, in_inside INTEGER,
  out_site_id INTEGER, out_distance_m REAL, out_inside INTEGER,
  -- fake-GPS heuristics
  in_spoof_score INTEGER, in_spoof_flags TEXT,
  out_spoof_score INTEGER, out_spoof_flags TEXT,
  UNIQUE (user_id, date)
);

-- Periodic location trail while an employee is on the clock (every ~10 min).
CREATE TABLE IF NOT EXISTS location_pings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          TEXT    NOT NULL,
  lat           REAL    NOT NULL,
  lng           REAL    NOT NULL,
  accuracy      REAL,
  address       TEXT,
  captured_at   TEXT    NOT NULL,
  source        TEXT    NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','punch','manual')),
  distance_m    REAL,
  inside        INTEGER,
  spoof_score   INTEGER,
  spoof_flags   TEXT
);

CREATE TABLE IF NOT EXISTS leaves (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL DEFAULT 'casual'
               CHECK (type IN ('casual','sick','earned','unpaid')),
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  days         REAL    NOT NULL DEFAULT 1,
  reason       TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  INTEGER REFERENCES users(id),
  reviewed_at  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS regularizations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                 TEXT    NOT NULL,
  requested_clock_in   TEXT,
  requested_clock_out  TEXT,
  reason               TEXT,
  status               TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
  reviewed_by          INTEGER REFERENCES users(id),
  reviewed_at          TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON leaves(status);
CREATE INDEX IF NOT EXISTS idx_pings_user_date ON location_pings(user_id, date);
`);

/* --- migration for databases created before the location/photo columns --- */
{
  const cols = db.prepare('PRAGMA table_info(attendance)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE attendance ADD COLUMN ${name} ${ddl}`); };
  add('in_lat', 'REAL'); add('in_lng', 'REAL'); add('in_accuracy', 'REAL'); add('in_address', 'TEXT'); add('in_photo', 'TEXT');
  add('out_lat', 'REAL'); add('out_lng', 'REAL'); add('out_accuracy', 'REAL'); add('out_address', 'TEXT'); add('out_photo', 'TEXT');
  add('in_site_id', 'INTEGER'); add('in_distance_m', 'REAL'); add('in_inside', 'INTEGER');
  add('out_site_id', 'INTEGER'); add('out_distance_m', 'REAL'); add('out_inside', 'INTEGER');
  add('in_spoof_score', 'INTEGER'); add('in_spoof_flags', 'TEXT');
  add('out_spoof_score', 'INTEGER'); add('out_spoof_flags', 'TEXT');
}
{
  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes('site_id')) db.exec('ALTER TABLE users ADD COLUMN site_id INTEGER');
  if (!ucols.includes('manager_id')) db.exec('ALTER TABLE users ADD COLUMN manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  const pcols = db.prepare('PRAGMA table_info(location_pings)').all().map((c) => c.name);
  for (const [n, t] of [['distance_m', 'REAL'], ['inside', 'INTEGER'], ['spoof_score', 'INTEGER'], ['spoof_flags', 'TEXT']]) {
    if (!pcols.includes(n)) db.exec(`ALTER TABLE location_pings ADD COLUMN ${n} ${t}`);
  }
}

/* ---------- small helpers used across routes ---------- */

export function todayStr(d = new Date()) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/** Inclusive list of YYYY-MM-DD between start and end. */
export function dateRange(start, end) {
  const out = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function isWeekend(dateStr) {
  const day = new Date(dateStr + 'T00:00:00').getDay();
  return day === 0 || day === 6;
}

/** Next employee code, e.g. VUT-0006. */
export function nextEmployeeCode(prefix = 'VUT') {
  const rows = db.prepare("SELECT employee_code FROM users WHERE employee_code LIKE ?").all(prefix + '-%');
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.employee_code).replace(/\D+/g, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export const WORK = { start: '09:30', end: '18:30', fullDayMinutes: 480, halfDayMinutes: 240 };
export const PING_INTERVAL_MINUTES = 10;

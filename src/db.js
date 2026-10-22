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
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
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
  UNIQUE (user_id, date)
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
`);

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

export const WORK = { start: '09:30', end: '18:30', fullDayMinutes: 480, halfDayMinutes: 240 };

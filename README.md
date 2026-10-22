# Keka Attendance

A Keka-style **attendance management system** with two roles — **User** (employee) and **Admin** — built as a full-stack app with a real database, session-based login, and an approval workflow.

Node.js + Express + SQLite (`better-sqlite3`) on the backend, plain HTML/CSS/JS on the frontend. No build step, no framework — clone it and run.

---

## Features

### Employee (User)
- **Session login** with hashed passwords (bcrypt).
- **Web punch in / punch out** with a live clock, and today's worked hours + status.
- **My attendance** — filterable history (last 30 days by default), late-punch marker, worked hours.
- **Monthly summary** — present / half-day / absent days and total hours.
- **Leave management** — apply for casual / sick / earned / loss-of-pay leave, see remaining balance, cancel a pending request.
- **Regularization** — raise a request to correct a missed or wrong punch.

### Admin
- **Team dashboard** — who is present, working now, absent or on leave today, with per-employee punch times.
- **Approvals** — approve/reject leave and regularization requests in one place, with a pending-count badge.
- **Employee management** — add employees, promote/demote between User and Admin, activate/deactivate accounts.
- **Monthly reports** — per-employee present / half / absent / leave days and total hours, with totals.

### How the roles differ
| | User | Admin |
|---|---|---|
| Punch in / out | ✅ own | ✅ own |
| View own attendance & leave | ✅ | ✅ |
| Apply for leave / regularization | ✅ | ✅ |
| View **all** employees' attendance | ❌ | ✅ |
| Approve / reject requests | ❌ | ✅ |
| Add / edit employees & roles | ❌ | ✅ |
| Monthly reports for the team | ❌ | ✅ |

Approving a leave marks the affected working days as `on_leave` and deducts the days from the employee's balance. Approving a regularization rewrites the punch times for that day.

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 18+ |
| Server | Express 4 |
| Database | SQLite via `better-sqlite3` (file at `data/attendance.db`) |
| Auth | `express-session` cookie sessions + `bcryptjs` password hashing |
| Frontend | Vanilla HTML / CSS / JS (no build step) |

---

## Quick start

```bash
git clone <your-repo-url>
cd keka-attendance
npm install
npm run seed        # creates the DB with demo users + sample history
npm start           # http://localhost:3000
```

Open http://localhost:3000 and sign in with a demo account below.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@keka.demo` | `Admin@123` |
| **User** | `aarav@keka.demo` | `User@123` |
| User | `priya@keka.demo` | `User@123` |
| User | `rahul@keka.demo` | `User@123` |
| User | `sneha@keka.demo` | `User@123` |

> These are seed/demo credentials only. Create real accounts through the admin UI and change them before any real use.

---

## Configuration

Copy `.env.example` to `.env` (or just export the vars) if you want to override defaults:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `SESSION_SECRET` | random per boot | Signing secret for session cookies. **Set this in production** so sessions survive restarts. |
| `DB_FILE` | `data/attendance.db` | SQLite file location |
| `NODE_ENV` | — | Set to `production` to mark cookies `secure` (requires HTTPS) |

---

## API reference

All routes are JSON. Auth is cookie-based; call `POST /api/auth/login` first.

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | current user |

### Employee (`/api/attendance`, `/api/leave`)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/attendance/today` | today's row |
| POST | `/api/attendance/clock-in` | |
| POST | `/api/attendance/clock-out` | |
| GET | `/api/attendance/history?from&to` | |
| GET | `/api/attendance/summary?month=YYYY-MM` | |
| POST | `/api/attendance/regularize` | `{ date, requested_clock_in, requested_clock_out, reason }` |
| GET | `/api/attendance/regularizations` | mine |
| GET | `/api/leave/types` | |
| GET | `/api/leave/balance` | |
| POST | `/api/leave` | `{ type, start_date, end_date, reason }` |
| GET | `/api/leave/mine` | |
| DELETE | `/api/leave/:id` | cancel a pending request |

### Admin (`/api/admin`, admin only)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/dashboard` | today's team stats + roster |
| GET | `/api/admin/employees` | |
| POST | `/api/admin/employees` | `{ name, email, password, role, department, employee_code, leave_balance }` |
| PATCH | `/api/admin/employees/:id` | update role / status / department / balance / password |
| GET | `/api/admin/attendance?date&user_id&from&to` | |
| GET | `/api/admin/leaves?status` | |
| PATCH | `/api/admin/leaves/:id` | `{ action: "approve" \| "reject" }` |
| GET | `/api/admin/regularizations?status` | |
| PATCH | `/api/admin/regularizations/:id` | `{ action }` |
| GET | `/api/admin/reports/summary?month=YYYY-MM` | |

---

## Project structure

```
keka-attendance/
├── server.js                 # Express app, session, static + page routes
├── package.json
├── src/
│   ├── db.js                 # SQLite connection + schema + date helpers
│   ├── seed.js               # demo data (npm run seed)
│   ├── middleware/auth.js    # requireAuth / requireAdmin
│   └── routes/
│       ├── auth.js           # login / logout / me
│       ├── attendance.js     # punch, history, summary, regularization
│       ├── leave.js          # apply, balance, cancel
│       └── admin.js          # dashboard, employees, approvals, reports
└── public/
    ├── index.html            # login
    ├── dashboard.html        # employee console
    ├── admin.html            # admin console
    ├── css/style.css
    └── js/{api,login,dashboard,admin}.js
```

---

## Data model

- **users** — id, name, email, password_hash, role (`admin`|`user`), department, employee_code, status (`active`|`inactive`), leave_balance.
- **attendance** — one row per user per day: clock_in, clock_out, status (`present`|`half_day`|`absent`|`on_leave`|`weekly_off`|`holiday`), worked_minutes, note. Unique on `(user_id, date)`.
- **leaves** — type, start_date, end_date, days, reason, status (`pending`|`approved`|`rejected`), reviewed_by/at.
- **regularizations** — date, requested punch times, reason, status, reviewed_by/at.

---

## Notes & next steps

- Sessions use the in-memory store, which is fine for local/demo use. For production, swap in a persistent session store (e.g. `connect-sqlite3` or Redis) and set a fixed `SESSION_SECRET`.
- The default work-day constants (start 09:30, end 18:30, 8h full day) live in `src/db.js` (`WORK`).
- Natural extensions: shift schedules, holidays calendar, biometric/geo-fenced punches, CSV export, and email notifications.

## License

MIT

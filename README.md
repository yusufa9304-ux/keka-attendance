# Vutto Attendance

A **Vutto-branded attendance management system** with two roles — **User** (employee) and **Admin** — built as a full-stack app with a real database, session-based login, and an approval workflow.

Node.js + Express + SQLite (`better-sqlite3`) on the backend, plain HTML/CSS/JS on the frontend. No build step.

> **Live demo:** a self-contained static build (same UI, data kept in your browser) is served from `/docs` via GitHub Pages — see [Live demo](#live-demo).

---

## Features

### Employee (User)
- **Session login** with hashed passwords (bcrypt).
- **Web punch in / punch out** with a live clock, today's worked hours and status.
- **My attendance** — filterable history, late-punch marker, worked hours.
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
npm run seed        # optional — the server also auto-seeds an empty database on first boot
npm start           # http://localhost:3000
```

Open http://localhost:3000 and sign in with a demo account below.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@vutto.demo` | `Admin@123` |
| **User** | `aarav@vutto.demo` | `User@123` |
| User | `priya@vutto.demo` | `User@123` |
| User | `rahul@vutto.demo` | `User@123` |
| User | `sneha@vutto.demo` | `User@123` |

> These are seed/demo credentials only. Create real accounts through the admin UI and change them before any real use.

---

## Live demo

The `docs/` folder holds a **self-contained static build** of the app — the same screens, roles and flows, with state kept in the browser's `localStorage` instead of a server. It is published with **GitHub Pages** (source: `main` branch, `/docs` folder):

```
https://<your-username>.github.io/keka-attendance/
```

It needs no backend, so it is handy for a quick look or a share link. The full-stack app (real database, sessions, REST API) is the code in the repo root — run it locally or deploy it with the bundled `Dockerfile`.

---

## Mobile & desktop (installable)

The app is a **responsive PWA** — one codebase that works on phones, tablets and desktops, and can be installed like a native app.

- **Desktop:** the usual top navigation, multi-column layout.
- **Phone / tablet:** the tab strip becomes a **bottom tab bar**, cards stack into a single column, tap targets are ≥ 44px, and wide tables scroll horizontally instead of squashing.
- **Install:** open the site in Chrome/Edge/Android and use the browser's *Install app* option (an **Install app** button also appears in the footer when the browser offers it). On iOS Safari, use *Share → Add to Home Screen*. It then opens full-screen from a home-screen icon, with a Vutto-yellow theme colour and app icon.
- **Offline shell:** a service worker caches the app shell, so the installed app opens instantly and still shows the interface without a network (API calls always go to the server and are never cached).

PWA pieces: `manifest.webmanifest`, `sw.js`, and `icons/` (192/512 + maskable + Apple touch) — present in both `docs/` (static build) and `public/` (full-stack app).

---

## Deploying the full-stack app

A `Dockerfile` is included. It listens on port `7860` and stores SQLite at `/tmp/attendance.db`, seeding demo data automatically on first boot.

**Any container host** (Render, Railway, Fly.io, a VPS):

```bash
docker build -t vutto-attendance .
docker run -p 7860:7860 vutto-attendance
```

**Render / Railway:** point the service at this repo — they detect the `Dockerfile` and build it. Set `SESSION_SECRET` to a long random string so sessions survive restarts.

> The container filesystem is ephemeral, so data resets when the container restarts (demo data is re-seeded on boot). For persistence, mount a volume and set `DB_FILE` to a path on it, or swap SQLite for Postgres.

---

## Configuration

Copy `.env.example` to `.env` (or export the vars):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `SESSION_SECRET` | random per boot | Signing secret for session cookies. **Set this in production.** |
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
├── Dockerfile                # container build for the full-stack app
├── package.json
├── src/
│   ├── db.js                 # SQLite connection + schema + date helpers
│   ├── seed.js               # demo data (npm run seed) + auto-seed on first boot
│   ├── middleware/auth.js    # requireAuth / requireAdmin
│   └── routes/
│       ├── auth.js           # login / logout / me
│       ├── attendance.js     # punch, history, summary, regularization
│       ├── leave.js          # apply, balance, cancel
│       └── admin.js          # dashboard, employees, approvals, reports
├── public/                   # full-stack frontend
│   ├── index.html            # login
│   ├── dashboard.html        # employee console
│   ├── admin.html            # admin console
│   ├── css/style.css         # Vutto theme
│   └── js/{api,login,dashboard,admin}.js
├── docs/                     # static demo build (served by GitHub Pages)
│   ├── index.html
│   ├── style.css
│   └── app.js
└── test/api.test.mjs         # end-to-end API tests (28 checks)
```

---

## Data model

- **users** — id, name, email, password_hash, role (`admin`|`user`), department, employee_code, status (`active`|`inactive`), leave_balance.
- **attendance** — one row per user per day: clock_in, clock_out, status (`present`|`half_day`|`absent`|`on_leave`|`weekly_off`|`holiday`), worked_minutes, note. Unique on `(user_id, date)`.
- **leaves** — type, start_date, end_date, days, reason, status (`pending`|`approved`|`rejected`), reviewed_by/at.
- **regularizations** — date, requested punch times, reason, status, reviewed_by/at.

---

## Tests

```bash
npm run seed && node test/api.test.mjs
```

Runs 28 checks against a live server: auth, role guards, punching, leave and regularization approval flows, employee management, and reports.

---

## Branding

The UI uses Vutto's brand palette, taken from vutto.in — **Vutto red `#E4002B`** with white and near-black, red pill buttons and soft pink tints. To re-skin, edit the CSS custom properties at the top of `public/css/style.css` (and `docs/style.css` for the static build).

## License

MIT

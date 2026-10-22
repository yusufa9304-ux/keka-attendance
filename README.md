# Vutto Attendance

A **Vutto-branded attendance management system** with two roles — **User** (employee) and **Admin** — built as a full-stack app with a real database, session-based login, and an approval workflow.

Node.js + Express + SQLite (`better-sqlite3`) on the backend, plain HTML/CSS/JS on the frontend. No build step.

> **Live demo:** a self-contained static build (same UI, data kept in your browser) is served from `/docs` via GitHub Pages — see [Live demo](#live-demo).

---

## Features

### Employee (User)
- **Session login** with hashed passwords (bcrypt).
- **Web punch in / punch out** with a live clock, today's worked hours and status.
- **Photo + location are mandatory on every punch** — the browser asks for a selfie (camera, with an upload fallback) and the GPS location, and both are stored with the punch.
- **Location trail** — while you are on the clock the app re-sends your location every **10 minutes** (only while the tab/app is open, and only if location permission was granted).
- **My attendance** — filterable history, late-punch marker, worked hours.
- **Monthly summary** — present / half-day / absent days and total hours.
- **Leave management** — apply for casual / sick / earned / loss-of-pay leave, see remaining balance, cancel a pending request.
- **Regularization** — raise a request to correct a missed or wrong punch.

### Geofencing (per showroom)
- Admins manage **sites** (showrooms / hubs) with a map pin and an allowed radius; employees are assigned to a site, or left as **field staff** (no geofence).
- Every punch is measured against that site: the distance is stored, and anything outside the radius is **flagged** in the roster, the employee's history and the payroll sheet.
- The employee sees the verdict on the punch card — *"✓ inside Vutto Showroom — Noida (45 m)"* or *"⚠ 1.8 km from …"* — and gets a warning toast when they are outside.

### Fake-GPS detection
- A web page cannot read the OS mock-location flag, so this is **heuristic scoring** (0–100) with the reasons recorded, meant as a signal for a human — not proof.
- Signals: reported accuracy of exactly 0 m, implausibly precise accuracy, a device clock that is far off the server, impossible travel between readings (>150 km/h), and identical coordinates across 5+ readings.
- Anything scoring 50+ is marked **⚠ GPS <score>** on the punch, in the roster and in the payroll sheet. A native app can read Android's `isMock` flag directly — that is the reliable way.

### Payroll export
- **CSV and Excel (.xlsx)** for any month, from the admin Reports tab (or `GET /api/admin/payroll/export?format=csv|xlsx&month=YYYY-MM`).
- Columns: employee code, name, department, site, present, half days, absent, paid leave, unpaid leave (LOP), **payable days**, worked hours, overtime hours, late marks, outside-geofence count, GPS-flag count.
- The `.xlsx` is written by a small dependency-free writer (`src/xlsx.js`) that works in Node and the browser.

### Reporting managers
- There is no separate "manager" role. A manager is simply someone with people reporting to them (`users.manager_id`), so they are still an ordinary employee who punches in and out.
- An admin sets the reporting line from the Employees screen — one dropdown per person. Self-reporting and reporting loops are refused, both in the UI and in the API.
- A manager gets a **My Team** view: their direct reports' roster, live locations and approvals — and nothing else. Company-wide screens (Employees, Sites, Payroll, Reports) stay admin-only.
- Scope rules live in one place (`src/team.js`) so every route agrees: admin sees everyone, a manager sees their direct reports, an employee sees only themselves. Nobody can approve their own request.
- An employee sees who they report to on their own dashboard.

### Admin
- **Team dashboard** — who is present, working now, absent or on leave today, with per-employee punch times, the **punch selfie**, the **check-in location** (a map link) and the **site/GPS verdict**.
- **Live locations** — a dedicated tab showing each employee's check-in location, last-seen time, latest tracked location and how many location updates were received that day.
- **Employee IDs are generated automatically** — adding an employee assigns the next code (`VUT-0006`, `VUT-0007`, …); there is no field to fill in.
- **Approvals** — approve/reject leave and regularization requests in one place, with a pending-count badge.
- **Employee management** — add employees, promote/demote between User and Admin, activate/deactivate accounts.
- **Monthly reports** — per-employee present / half / absent / leave days and total hours, with totals.

### Sites API
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/sites` | list sites with radius, map link and staff count |
| POST | `/api/admin/sites` | `{ name, address, lat, lng, radius_m }` |
| PATCH | `/api/admin/sites/:id` | update name/address/coords/radius/active |
| DELETE | `/api/admin/sites/:id` | delete; its employees become field staff |
| GET | `/api/admin/payroll?month=YYYY-MM` | payroll figures as JSON |
| GET | `/api/admin/payroll/export?month=&format=csv\|xlsx` | download the payroll sheet |

### Where the location comes from

Location is read in the browser with the **Geolocation API** and stored with the punch (latitude, longitude, accuracy) plus a best-effort street address (reverse-geocoded via OpenStreetMap's Nominatim; if that call fails the coordinates are shown instead). Every location shows as a **Google Maps link**. Nothing is tracked while the employee is clocked out, and the periodic updates only run while the app is open.

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

/* Vutto Attendance — self-contained demo build.
   Same UI and flows as the full-stack app, but state is kept in the browser
   (localStorage) so it can run as a static site. No server required. */

/* ----------------------------- store ----------------------------- */
const LS_KEY = 'vutto_attendance_v1';
const WORK = { start: '09:30', fullDay: 480, halfDay: 240 };

const todayStr = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); };
const isWeekend = (ds) => { const g = new Date(ds + 'T00:00:00').getDay(); return g === 0 || g === 6; };
const dateRange = (a, b) => { const out = []; let c = a, g = 0; while (c <= b && g++ < 400) { out.push(c); c = addDays(c, 1); } return out; };
const workingDays = (a, b) => dateRange(a, b).filter((d) => !isWeekend(d)).length || 1;

function seed() {
  const users = [];
  const mk = (name, email, password, role, department, code, bal) =>
    users.push({ id: users.length + 1, name, email, password, role, department, employee_code: code, status: 'active', leave_balance: bal });
  mk('Yusuf Admin', 'admin@vutto.demo', 'Admin@123', 'admin', 'HR', 'VUT-0001', 18);
  mk('Aarav Sharma', 'aarav@vutto.demo', 'User@123', 'user', 'Engineering', 'VUT-0002', 14);
  mk('Priya Nair', 'priya@vutto.demo', 'User@123', 'user', 'Design', 'VUT-0003', 16);
  mk('Rahul Verma', 'rahul@vutto.demo', 'User@123', 'user', 'Sales', 'VUT-0004', 12);
  mk('Sneha Iyer', 'sneha@vutto.demo', 'User@123', 'user', 'Engineering', 'VUT-0005', 18);

  const SITES = [
    { lat: 28.6139, lng: 77.2090, address: 'Connaught Place, New Delhi' },
    { lat: 28.5355, lng: 77.3910, address: 'Sector 62, Noida' },
    { lat: 28.4595, lng: 77.0266, address: 'Sector 29, Gurugram' },
    { lat: 28.6692, lng: 77.4538, address: 'Vaishali, Ghaziabad' },
  ];
  const location_pings = [];
  let pid = 1;
  const attendance = [];
  let aid = 1;
  const today = todayStr();
  const emps = users.filter((u) => u.role === 'user');
  for (let back = 14; back >= 0; back--) {
    const date = addDays(today, -back);
    if (isWeekend(date)) continue;
    emps.forEach((e, i) => {
      const absent = back === 6 && i === 2;
      const half = back === 3 && i === 1;
      if (absent) { attendance.push({ id: aid++, user_id: e.id, date, clock_in: null, clock_out: null, status: 'absent', worked_minutes: 0, note: 'No show' }); return; }
      const isToday = back === 0;
      if (isToday && i === 0) return; // leave one person unpunched so clock-in can be demoed
      const inH = 9 + (i % 2), inM = (i * 7) % 40;
      const cin = `${date}T${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00`;
      const outH = half ? 13 : 18, outM = half ? 30 : 15 + ((i * 5) % 30);
      const cout = isToday ? null : `${date}T${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}:00`;
      const worked = isToday ? 0 : (outH * 60 + outM) - (inH * 60 + inM);
      const site = SITES[i % SITES.length];
      attendance.push({
        id: aid++, user_id: e.id, date, clock_in: cin, clock_out: cout,
        status: isToday ? 'present' : (half ? 'half_day' : 'present'), worked_minutes: worked, note: null,
        in_lat: site.lat, in_lng: site.lng, in_address: site.address, in_photo: null,
        out_lat: null, out_lng: null, out_address: null, out_photo: null,
      });
      if (isToday) {
        for (let k = 1; k <= 3; k++) {
          location_pings.push({
            id: pid++, user_id: e.id, date,
            lat: site.lat + k * 0.0012, lng: site.lng + k * 0.0009,
            accuracy: 18 + k, address: site.address,
            captured_at: `${date}T${String(10 + k).padStart(2, '0')}:${String((i * 7 + k * 3) % 60).padStart(2, '0')}:00`,
            source: 'auto',
          });
        }
      }
    });
  }

  const leaves = [
    { id: 1, user_id: 2, type: 'casual', start_date: addDays(today, 3), end_date: addDays(today, 4), days: 2, reason: 'Family function out of town', status: 'pending', reviewed_at: null },
    { id: 2, user_id: 3, type: 'sick', start_date: addDays(today, 1), end_date: addDays(today, 1), days: 1, reason: 'Fever, doctor advised rest', status: 'pending', reviewed_at: null },
  ];
  const regularizations = [
    { id: 1, user_id: 4, date: addDays(today, -2), requested_clock_in: `${addDays(today, -2)}T09:35:00`, requested_clock_out: `${addDays(today, -2)}T18:40:00`, reason: 'Forgot to clock out, was on client call', status: 'pending', reviewed_at: null },
  ];

  return { users, attendance, leaves, regularizations, location_pings, session: null, seq: { u: 6, a: aid, l: 3, r: 2, p: pid } };
}

function load() {
  try { const s = localStorage.getItem(LS_KEY); if (s) return JSON.parse(s); } catch {}
  const st = seed(); persist(st); return st;
}
function persist(st = DB) { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch {} }
let DB = load();
DB.location_pings ||= [];
DB.seq = DB.seq || {};
DB.seq.p ||= (DB.location_pings.length + 1);

/* Safety net: a demo must never end up with no active admin, or nobody could
   reach the admin console again. If that happens, restore the demo admin. */
(function ensureAnActiveAdmin() {
  if (DB.users.some((u) => u.role === 'admin' && u.status === 'active')) return;
  const a = DB.users.find((u) => String(u.email).toLowerCase() === 'admin@vutto.demo');
  if (a) { a.role = 'admin'; a.status = 'active'; }
  else DB.users.push({
    id: DB.seq.u++, name: 'Yusuf Admin', email: 'admin@vutto.demo', password: 'Admin@123',
    role: 'admin', department: 'HR', employee_code: 'VUT-0001', status: 'active', leave_balance: 18,
  });
  persist();
})();

const ui = {
  tab: null, atab: null,
  histFrom: addDays(todayStr(), -29), histTo: todayStr(),
  repMonth: todayStr().slice(0, 7),
  lvType: 'casual', rgDate: todayStr(),
};

/* ----------------------------- helpers ----------------------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const initials = (n) => String(n || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—');
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtHours = (h) => { if (!h) return '0h 0m'; const H = Math.floor(h), M = Math.round((h - H) * 60); return `${H}h ${M}m`; };
const me = () => DB.users.find((u) => u.id === DB.session) || null;

function toast(msg, isErr = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ----------------------------- actions ----------------------------- */
const todayRow = (uid) => DB.attendance.find((a) => a.user_id === uid && a.date === todayStr());
const workedHours = (r) => (r && r.worked_minutes ? +(r.worked_minutes / 60).toFixed(2) : 0);

function addPing(u, date, pos, source = 'auto', at = new Date().toISOString()) {
  DB.location_pings.push({
    id: DB.seq.p++, user_id: u.id, date,
    lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy ?? null,
    address: pos.address || null, captured_at: at, source,
  });
}

async function doPunch(kind) {
  const u = me();
  try {
    const proof = await CAPTURE.punchProof((msg) => toast(msg));
    const now = new Date().toISOString();
    const date = todayStr();
    if (kind === 'in') {
      let r = todayRow(u.id);
      if (r && r.clock_in) { toast('You have already clocked in today', true); return render(); }
      if (!r) {
        DB.attendance.push({
          id: DB.seq.a++, user_id: u.id, date, clock_in: now, clock_out: null,
          status: 'present', worked_minutes: 0, note: null,
          in_lat: proof.lat, in_lng: proof.lng, in_address: proof.address, in_photo: proof.photo,
          out_lat: null, out_lng: null, out_address: null, out_photo: null,
        });
      } else {
        r.clock_in = now; r.status = 'present'; r.note = null;
        r.in_lat = proof.lat; r.in_lng = proof.lng; r.in_address = proof.address; r.in_photo = proof.photo;
      }
      addPing(u, date, proof, 'punch', now);
      toast('Clocked in — photo + location saved');
    } else {
      const r = todayRow(u.id);
      if (!r || !r.clock_in) { toast('You need to clock in first', true); return render(); }
      if (r.clock_out) { toast('You have already clocked out today', true); return render(); }
      r.clock_out = now;
      r.worked_minutes = Math.max(0, Math.round((new Date(now) - new Date(r.clock_in)) / 60000));
      r.status = r.worked_minutes < WORK.halfDay ? 'half_day' : 'present';
      r.out_lat = proof.lat; r.out_lng = proof.lng; r.out_address = proof.address; r.out_photo = proof.photo;
      addPing(u, date, proof, 'punch', now);
      toast('Clocked out — photo + location saved');
    }
    persist(); render();
  } catch (err) {
    toast(err.message, true);
    render();
  }
}

/* ---- periodic location tracking (every 10 min while on the clock) ---- */
let tracker = null;
const PING_MIN = 10;
function startTracking() {
  if (tracker) return;
  tracker = CAPTURE.startTracking(PING_MIN, async (pos) => {
    const u = me(); if (!u) return;
    addPing(u, todayStr(), pos, 'auto');
    persist();
  });
}
function stopTracking() { if (tracker) { tracker.stop(); tracker = null; } }

const mapsUrl = (lat, lng) => (lat != null ? `https://www.google.com/maps?q=${lat},${lng}` : null);
const fmtCoords = (lat, lng) => `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;

window.viewPhoto = (src) => {
  let m = document.getElementById('photo-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'photo-modal'; m.className = 'modal-bg';
    m.innerHTML = '<div class="modal photo-viewer"><h2>Punch photo</h2><img id="photo-img" alt="Punch photo" /><div class="foot"><button class="btn ghost" id="photo-close">Close</button></div></div>';
    document.body.appendChild(m);
    m.onclick = (e) => { if (e.target === m) m.classList.remove('open'); };
    m.querySelector('#photo-close').onclick = () => m.classList.remove('open');
  }
  m.querySelector('#photo-img').src = src;
  m.classList.add('open');
};

function usedLeave(uid) {
  const y = String(new Date().getFullYear());
  return DB.leaves.filter((l) => l.user_id === uid && l.status === 'approved' && l.type !== 'unpaid' && l.start_date.slice(0, 4) === y)
    .reduce((a, l) => a + l.days, 0);
}
function applyLeave(body) {
  const u = me();
  if (!body.start_date || !body.end_date) return toast('Please pick both dates', true);
  if (body.end_date < body.start_date) return toast('End date cannot be before start date', true);
  const days = workingDays(body.start_date, body.end_date);
  DB.leaves.push({ id: DB.seq.l++, user_id: u.id, type: body.type, start_date: body.start_date, end_date: body.end_date, days, reason: body.reason || null, status: 'pending', reviewed_at: null });
  persist(); toast(`Leave request submitted (${days} day${days > 1 ? 's' : ''})`); render();
}
function cancelLeave(id) {
  const u = me();
  const l = DB.leaves.find((x) => x.id === id && x.user_id === u.id);
  if (!l) return;
  if (l.status !== 'pending') return toast('Only pending requests can be cancelled', true);
  DB.leaves = DB.leaves.filter((x) => x.id !== id);
  persist(); toast('Request cancelled'); render();
}
function raiseReg(body) {
  const u = me();
  if (!body.date || !body.reason) return toast('Date and reason are required', true);
  DB.regularizations.push({
    id: DB.seq.r++, user_id: u.id, date: body.date,
    requested_clock_in: body.in ? `${body.date}T${body.in}:00` : null,
    requested_clock_out: body.out ? `${body.date}T${body.out}:00` : null,
    reason: body.reason, status: 'pending', reviewed_at: null,
  });
  persist(); toast('Regularization request submitted'); render();
}

function reviewLeave(id, action) {
  const l = DB.leaves.find((x) => x.id === id);
  if (!l || l.status !== 'pending') return toast('This request has already been reviewed', true);
  l.status = action === 'approve' ? 'approved' : 'rejected';
  l.reviewed_at = new Date().toISOString();
  if (l.status === 'approved') {
    const u = DB.users.find((x) => x.id === l.user_id);
    if (u && l.type !== 'unpaid') u.leave_balance = +(u.leave_balance - l.days).toFixed(1);
    for (const d of dateRange(l.start_date, l.end_date)) {
      if (isWeekend(d)) continue;
      let r = DB.attendance.find((a) => a.user_id === l.user_id && a.date === d);
      if (r) { r.status = 'on_leave'; r.clock_in = null; r.clock_out = null; r.worked_minutes = 0; }
      else DB.attendance.push({ id: DB.seq.a++, user_id: l.user_id, date: d, clock_in: null, clock_out: null, status: 'on_leave', worked_minutes: 0, note: null });
    }
  }
  persist(); toast(`Leave ${l.status === 'approved' ? 'approved' : 'rejected'}`); render();
}
function reviewReg(id, action) {
  const r = DB.regularizations.find((x) => x.id === id);
  if (!r || r.status !== 'pending') return toast('This request has already been reviewed', true);
  r.status = action === 'approve' ? 'approved' : 'rejected';
  r.reviewed_at = new Date().toISOString();
  if (r.status === 'approved') {
    const worked = r.requested_clock_in && r.requested_clock_out
      ? Math.max(0, Math.round((new Date(r.requested_clock_out) - new Date(r.requested_clock_in)) / 60000)) : 0;
    let a = DB.attendance.find((x) => x.user_id === r.user_id && x.date === r.date);
    if (!a) { a = { id: DB.seq.a++, user_id: r.user_id, date: r.date, clock_in: null, clock_out: null, status: 'present', worked_minutes: 0, note: null }; DB.attendance.push(a); }
    if (r.requested_clock_in) a.clock_in = r.requested_clock_in;
    if (r.requested_clock_out) a.clock_out = r.requested_clock_out;
    a.worked_minutes = worked; a.status = 'present'; a.note = 'Regularized';
  }
  persist(); toast(`Regularization ${r.status === 'approved' ? 'approved' : 'rejected'}`); render();
}
function nextEmployeeCode() {
  let max = 0;
  for (const u of DB.users) {
    const n = parseInt(String(u.employee_code || '').replace(/\D+/g, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `VUT-${String(max + 1).padStart(4, '0')}`;
}

function addEmployee(body) {
  if (!body.name || !body.email || !body.password) return toast('Name, email and password are required', true);
  if (DB.users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) return toast('An account with this email already exists', true);
  DB.users.push({
    id: DB.seq.u++, name: body.name, email: body.email, password: body.password,
    role: body.role || 'user', department: body.department || null,
    employee_code: nextEmployeeCode(), status: 'active', leave_balance: body.leave_balance ?? 18,
  });
  persist(); toast('Employee created'); closeModal(); render();
}
function patchEmployee(id, patch) {
  const u = DB.users.find((x) => x.id === id);
  if (!u) return;
  // Never let an admin lock themselves out of the admin console.
  const self = me();
  if (self && id === self.id) {
    if (patch.role && patch.role !== 'admin') return toast("You can't change your own role — ask another admin.", true);
    if (patch.status && patch.status !== 'active') return toast("You can't deactivate your own account.", true);
  }
  Object.assign(u, patch);
  persist(); toast('Employee updated'); render();
}

/* ----------------------------- rendering ----------------------------- */
const appEl = () => document.getElementById('app-view');
const mainEl = () => document.getElementById('main');

function render() {
  const u = me();
  if (!u) { document.getElementById('login-view').classList.remove('hidden'); appEl().classList.add('hidden'); return; }
  document.getElementById('login-view').classList.add('hidden');
  appEl().classList.remove('hidden');

  document.getElementById('nav-avatar').textContent = initials(u.name);
  document.getElementById('nav-name').textContent = u.name;
  document.getElementById('nav-role').textContent = u.role === 'admin' ? 'Administrator' : (u.department ? `${u.department} · Employee` : 'Employee');
  document.getElementById('admin-tag').classList.toggle('hidden', u.role !== 'admin');

  if (u.role === 'admin') renderAdmin(); else renderUser();
}

function renderUser() {
  const u = me();
  if (!ui.tab) ui.tab = 'home';
  const tabs = [['home', 'My Day'], ['history', 'My Attendance'], ['leave', 'Leaves'], ['reg', 'Regularization']];
  document.getElementById('nav-links').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${ui.tab === k ? 'active' : ''}">${l}</button>`).join('');

  const month = todayStr().slice(0, 7);
  const rows = DB.attendance.filter((a) => a.user_id === u.id && a.date.startsWith(month));
  const summary = {
    present: rows.filter((r) => r.status === 'present').length,
    half: rows.filter((r) => r.status === 'half_day').length,
    absent: rows.filter((r) => r.status === 'absent').length,
    hours: +(rows.reduce((a, r) => a + r.worked_minutes, 0) / 60).toFixed(2),
  };
  const bal = { entitlement: u.leave_balance, used: usedLeave(u.id) };
  bal.remaining = +(bal.entitlement - bal.used).toFixed(1);

  const t = todayRow(u.id);
  const worked = t && t.worked_minutes ? fmtHours(t.worked_minutes / 60) : '—';
  const pingsToday = DB.location_pings.filter((p) => p.user_id === u.id && p.date === todayStr()).length;
  const onClock = !!(t && t.clock_in && !t.clock_out);
  const punchLoc = (r, kind) => {
    const lat = kind === 'in' ? r.in_lat : r.out_lat;
    if (lat == null) return '';
    const lng = kind === 'in' ? r.in_lng : r.out_lng;
    const addr = (kind === 'in' ? r.in_address : r.out_address) || fmtCoords(lat, lng);
    const photo = kind === 'in' ? r.in_photo : r.out_photo;
    return `<div class="photo-row" style="justify-content:center;margin-top:10px">
      ${photo ? `<img class="punch-photo" src="${photo}" alt="${kind} photo" onclick="viewPhoto(this.src)" />` : ''}
      <span class="loc"><span class="pin">📍</span> <a href="${mapsUrl(lat, lng)}" target="_blank" rel="noopener">${esc(addr)}</a></span>
    </div>`;
  };
  const clockPanel = `
    <div class="card clock">
      <div class="now" id="live-clock">--:--:--</div>
      <div class="date" id="live-date">—</div>
      <div class="actions">
        <button class="btn primary" id="btn-in" ${t && t.clock_in ? 'disabled' : ''}>Clock in</button>
        <button class="btn dark" id="btn-out" ${!t || !t.clock_in || t.clock_out ? 'disabled' : ''}>Clock out</button>
      </div>
      <div class="punch-meta">
        <div><div class="k">Clock in</div><div class="v">${fmtTime(t && t.clock_in)}</div></div>
        <div><div class="k">Clock out</div><div class="v">${fmtTime(t && t.clock_out)}</div></div>
        <div><div class="k">Worked</div><div class="v">${worked}</div></div>
        <div><div class="k">Status</div><div class="v">${t ? `<span class="badge ${t.status}">${label(t.status)}</span>` : '<span class="badge not_in">Not marked</span>'}</div></div>
      </div>
      ${t ? punchLoc(t, 'in') : ''}
      ${t && t.clock_out ? punchLoc(t, 'out') : ''}
      <div class="track-note">${onClock
        ? `📍 On the clock — location updates every ${PING_MIN} min (${pingsToday} update${pingsToday === 1 ? '' : 's'} so far today).`
        : `📍 Location + a selfie are required for every punch. ${pingsToday ? pingsToday + ' location update(s) recorded today.' : ''}`}</div>
    </div>`;
  if (onClock) startTracking(); else stopTracking();

  const statsPanel = `
    <div class="card">
      <h2>This month</h2>
      <div class="grid cols-2" style="gap:14px">
        <div class="stat"><span class="label">Present</span><span class="value">${summary.present}</span><span class="sub">days</span></div>
        <div class="stat"><span class="label">Half days</span><span class="value">${summary.half}</span><span class="sub">days</span></div>
        <div class="stat"><span class="label">Absent</span><span class="value">${summary.absent}</span><span class="sub">days</span></div>
        <div class="stat"><span class="label">Hours</span><span class="value">${summary.hours}</span><span class="sub">total</span></div>
      </div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0" />
      <div class="stat"><span class="label">Leave balance</span><span class="value">${bal.remaining}</span><span class="sub">${bal.used} used of ${bal.entitlement} this year</span></div>
    </div>`;

  let panel = '';
  if (ui.tab === 'home') {
    panel = `<div class="page-head"><div><h1>Hi, ${esc(u.name.split(' ')[0])}</h1><p class="muted">${esc(u.employee_code || '')} · ${esc(u.department || 'Employee')}</p></div></div>
      <div class="grid cols-2">${clockPanel}${statsPanel}</div>`;
  } else if (ui.tab === 'history') {
    const recs = DB.attendance.filter((a) => a.user_id === u.id && a.date >= ui.histFrom && a.date <= ui.histTo).sort((a, b) => b.date.localeCompare(a.date));
    panel = `<div class="page-head"><h1>Attendance history</h1>
      <div style="display:flex;gap:8px;align-items:center">
        <label class="small muted">From</label><input type="date" id="hist-from" value="${ui.histFrom}" style="padding:6px 10px;border:1px solid var(--line);border-radius:8px" />
        <label class="small muted">To</label><input type="date" id="hist-to" value="${ui.histTo}" style="padding:6px 10px;border:1px solid var(--line);border-radius:8px" />
        <button class="btn sm" id="hist-go">Apply</button>
      </div></div>
      <div class="card"><table><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th class="num">Worked</th><th>Photo</th><th>Check-in location</th><th>Status</th></tr></thead>
      <tbody>${recs.length ? recs.map((r) => `<tr>
        <td>${fmtDate(r.date)}</td>
        <td>${fmtTime(r.clock_in)}${r.clock_in && r.clock_in.slice(11, 16) > WORK.start ? ' <span class="badge half_day" style="font-size:.7rem">late</span>' : ''}</td>
        <td>${fmtTime(r.clock_out)}</td>
        <td class="num">${r.worked_minutes ? fmtHours(r.worked_minutes / 60) : '—'}</td>
        <td>${r.in_photo ? `<img class="punch-photo" src="${r.in_photo}" alt="in" onclick="viewPhoto(this.src)" />` : '<span class="muted small">—</span>'}</td>
        <td class="small">${r.in_lat != null ? `<a href="${mapsUrl(r.in_lat, r.in_lng)}" target="_blank" rel="noopener"><span class="pin">📍</span> ${esc(r.in_address || fmtCoords(r.in_lat, r.in_lng))}</a>` : '<span class="muted">—</span>'}</td>
        <td><span class="badge ${r.status}">${label(r.status)}</span></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No records in this range.</td></tr>'}</tbody></table></div>`;
  } else if (ui.tab === 'leave') {
    const mine = DB.leaves.filter((l) => l.user_id === u.id).sort((a, b) => b.id - a.id);
    panel = `<div class="page-head"><h1>Leaves</h1></div>
      <div class="grid cols-2">
        <div class="card"><h2>My leave requests</h2>
          <table><thead><tr><th>Type</th><th>From → To</th><th class="num">Days</th><th>Status</th><th></th></tr></thead>
          <tbody>${mine.length ? mine.map((l) => `<tr>
            <td>${label(l.type)}</td><td>${fmtDate(l.start_date)} → ${fmtDate(l.end_date)}</td>
            <td class="num">${l.days}</td><td><span class="badge ${l.status}">${label(l.status)}</span></td>
            <td>${l.status === 'pending' ? `<button class="btn sm ghost" data-cancel="${l.id}">Cancel</button>` : ''}</td></tr>`).join('')
            : '<tr><td colspan="5" class="empty">No leave requests yet.</td></tr>'}</tbody></table></div>
        <div class="card"><h2>Apply for leave</h2>
          <div class="field"><label>Leave type</label><select id="lv-type">
            ${[['casual', 'Casual Leave'], ['sick', 'Sick Leave'], ['earned', 'Earned Leave'], ['unpaid', 'Loss of Pay']].map(([v, l]) => `<option value="${v}" ${ui.lvType === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
          <div class="row2">
            <div class="field"><label>From</label><input type="date" id="lv-start" /></div>
            <div class="field"><label>To</label><input type="date" id="lv-end" /></div>
          </div>
          <div class="field"><label>Reason</label><textarea id="lv-reason" rows="3" placeholder="Optional note for your manager"></textarea></div>
          <button class="btn primary" id="lv-submit">Submit request</button>
          <div class="small muted" style="margin-top:10px">You have ${bal.remaining} days of paid leave remaining.</div>
        </div></div>`;
  } else {
    const regs = DB.regularizations.filter((r) => r.user_id === u.id).sort((a, b) => b.id - a.id);
    panel = `<div class="page-head"><h1>Regularization</h1></div>
      <div class="grid cols-2">
        <div class="card"><h2>My regularization requests</h2>
          <table><thead><tr><th>Date</th><th>Requested</th><th>Status</th></tr></thead>
          <tbody>${regs.length ? regs.map((r) => `<tr><td>${fmtDate(r.date)}</td>
            <td class="small">${fmtTime(r.requested_clock_in)} → ${fmtTime(r.requested_clock_out)}</td>
            <td><span class="badge ${r.status}">${label(r.status)}</span></td></tr>`).join('')
            : '<tr><td colspan="3" class="empty">No regularization requests.</td></tr>'}</tbody></table></div>
        <div class="card"><h2>Raise a regularization</h2>
          <p class="small muted">Missed a punch or clocked in late by mistake? Ask your admin to correct it.</p>
          <div class="field"><label>Date</label><input type="date" id="rg-date" value="${ui.rgDate}" /></div>
          <div class="row2">
            <div class="field"><label>Correct clock in</label><input type="time" id="rg-in" /></div>
            <div class="field"><label>Correct clock out</label><input type="time" id="rg-out" /></div>
          </div>
          <div class="field"><label>Reason</label><textarea id="rg-reason" rows="3" placeholder="e.g. Forgot to clock out"></textarea></div>
          <button class="btn primary" id="rg-submit">Submit request</button>
        </div></div>`;
  }
  mainEl().innerHTML = panel;
  bindUser();
  startClock();
}

function renderAdmin() {
  const u = me();
  if (!ui.tab || !['team', 'locations', 'approvals', 'employees', 'reports'].includes(ui.tab)) ui.tab = 'team';
  if (!ui.atab) ui.atab = 'leaves';
  const pending = DB.leaves.filter((l) => l.status === 'pending').length + DB.regularizations.filter((r) => r.status === 'pending').length;
  const tabs = [['team', 'Team Today'], ['locations', 'Locations'], ['approvals', `Approvals ${pending ? `<span class="badge pending">${pending}</span>` : ''}`], ['employees', 'Employees'], ['reports', 'Reports']];
  document.getElementById('nav-links').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${ui.tab === k ? 'active' : ''}">${l}</button>`).join('');

  const date = todayStr();
  const emps = DB.users.filter((x) => x.status === 'active' && x.role === 'user');
  const team = emps.map((e) => {
    const a = DB.attendance.find((x) => x.user_id === e.id && x.date === date);
    const state = a && a.clock_in && !a.clock_out ? 'working' : a && a.clock_out ? 'done' : a && a.status === 'on_leave' ? 'on_leave' : 'not_in';
    return { e, a, state };
  });
  const stats = {
    total: emps.length,
    present: team.filter((t) => t.a && t.a.clock_in && t.a.status !== 'on_leave').length,
    working: team.filter((t) => t.state === 'working').length,
    absent: team.filter((t) => t.state === 'not_in').length,
    leave: team.filter((t) => t.a && t.a.status === 'on_leave').length,
  };

  const head = `
    <div class="page-head">
      <div><h1>Team dashboard</h1><p class="muted">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <button class="btn" id="refresh">↻ Refresh</button>
    </div>
    <div class="grid cols-4" style="margin-bottom:18px">
      <div class="card stat"><span class="label">Employees</span><span class="value">${stats.total}</span><span class="sub">active</span></div>
      <div class="card stat"><span class="label">Present today</span><span class="value">${stats.present}</span><span class="sub">clocked in</span></div>
      <div class="card stat"><span class="label">Working now</span><span class="value">${stats.working}</span><span class="sub">not clocked out</span></div>
      <div class="card stat"><span class="label">On leave / absent</span><span class="value">${stats.absent + stats.leave}</span><span class="sub">${stats.absent} absent · ${stats.leave} on leave</span></div>
    </div>`;

  let panel = '';
  const locCell = (lat, lng, address) => (lat != null
    ? `<a href="${mapsUrl(lat, lng)}" target="_blank" rel="noopener" class="small"><span class="pin">📍</span> ${esc(address || fmtCoords(lat, lng))}</a>`
    : '<span class="muted small">—</span>');
  const photoCell = (src) => (src
    ? `<img class="punch-photo" src="${src}" alt="punch photo" onclick="viewPhoto(this.src)" />`
    : '<span class="muted small">—</span>');

  if (ui.tab === 'team') {
    panel = `<div class="card"><h2>Team status — today</h2>
      <table><thead><tr><th>Employee</th><th>Department</th><th>Clock in</th><th>Clock out</th><th class="num">Worked</th><th>Photo</th><th>Check-in location</th><th>State</th></tr></thead>
      <tbody>${team.length ? team.map(({ e, a, state }) => `<tr>
        <td><b>${esc(e.name)}</b><div class="muted small">${esc(e.employee_code || '')}</div></td>
        <td>${esc(e.department || '—')}</td><td>${fmtTime(a && a.clock_in)}</td><td>${fmtTime(a && a.clock_out)}</td>
        <td class="num">${a && a.worked_minutes ? fmtHours(a.worked_minutes / 60) : '—'}</td>
        <td>${photoCell(a && a.in_photo)}</td>
        <td>${locCell(a && a.in_lat, a && a.in_lng, a && a.in_address)}</td>
        <td><span class="badge ${state}">${label(state)}</span></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No employees yet.</td></tr>'}</tbody></table></div>`;
  } else if (ui.tab === 'locations') {
    const rows = team.map(({ e, a }) => {
      const list = DB.location_pings.filter((p) => p.user_id === e.id && p.date === date)
        .sort((x, y) => String(y.captured_at).localeCompare(String(x.captured_at)));
      const latest = list[0] || null;
      return { e, a, latest, count: list.length, onClock: !!(a && a.clock_in && !a.clock_out) };
    });
    panel = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap">
        <h2>Live locations</h2><span class="ping-count">${date} · updates every ${PING_MIN} min</span></div>
      <table><thead><tr><th>Employee</th><th>On clock</th><th>Check-in location</th><th>Last seen</th><th>Latest location</th><th class="num">Updates</th></tr></thead>
      <tbody>${rows.map(({ e, a, latest, count, onClock }) => `<tr>
        <td><b>${esc(e.name)}</b><div class="muted small">${esc(e.employee_code || '')}</div></td>
        <td>${onClock ? '<span class="badge working">On clock</span>' : (a && a.clock_out ? '<span class="badge done">Clocked out</span>' : '<span class="badge not_in">Not in</span>')}</td>
        <td>${locCell(a && a.in_lat, a && a.in_lng, a && a.in_address)}</td>
        <td class="small">${latest ? fmtTime(latest.captured_at) : '<span class="muted">—</span>'}</td>
        <td>${latest ? locCell(latest.lat, latest.lng, latest.address) : '<span class="muted small">—</span>'}</td>
        <td class="num">${count}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (ui.tab === 'approvals') {
    const leaves = DB.leaves.slice().sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.id - a.id);
    const regs = DB.regularizations.slice().sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.id - a.id);
    panel = `<div class="tabs">
        <button data-atab="leaves" class="${ui.atab === 'leaves' ? 'active' : ''}">Leave requests</button>
        <button data-atab="regs" class="${ui.atab === 'regs' ? 'active' : ''}">Regularizations</button>
      </div>
      <div class="card ${ui.atab === 'leaves' ? '' : 'hidden'}"><h2>Leave requests</h2>
        <table><thead><tr><th>Employee</th><th>Type</th><th>From → To</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
        <tbody>${leaves.length ? leaves.map((l) => { const e = DB.users.find((x) => x.id === l.user_id); return `<tr>
          <td><b>${esc(e ? e.name : '—')}</b><div class="muted small">${esc(e ? e.department : '')}</div></td>
          <td>${label(l.type)}</td><td>${fmtDate(l.start_date)} → ${fmtDate(l.end_date)}</td><td class="num">${l.days}</td>
          <td class="muted small" style="max-width:220px">${esc(l.reason || '')}</td>
          <td><span class="badge ${l.status}">${label(l.status)}</span></td>
          <td>${l.status === 'pending' ? `<button class="btn sm green" data-lv="${l.id}" data-act="approve">Approve</button>
            <button class="btn sm red" style="margin-left:6px" data-lv="${l.id}" data-act="reject">Reject</button>` : ''}</td></tr>`; }).join('')
          : '<tr><td colspan="7" class="empty">No leave requests.</td></tr>'}</tbody></table></div>
      <div class="card ${ui.atab === 'regs' ? '' : 'hidden'}"><h2>Regularization requests</h2>
        <table><thead><tr><th>Employee</th><th>Date</th><th>Requested</th><th>Reason</th><th>Status</th><th></th></tr></thead>
        <tbody>${regs.length ? regs.map((r) => { const e = DB.users.find((x) => x.id === r.user_id); return `<tr>
          <td><b>${esc(e ? e.name : '—')}</b><div class="muted small">${esc(e ? e.department : '')}</div></td>
          <td>${fmtDate(r.date)}</td><td class="small">${fmtTime(r.requested_clock_in)} → ${fmtTime(r.requested_clock_out)}</td>
          <td class="muted small" style="max-width:220px">${esc(r.reason || '')}</td>
          <td><span class="badge ${r.status}">${label(r.status)}</span></td>
          <td>${r.status === 'pending' ? `<button class="btn sm green" data-rg="${r.id}" data-act="approve">Approve</button>
            <button class="btn sm red" style="margin-left:6px" data-rg="${r.id}" data-act="reject">Reject</button>` : ''}</td></tr>`; }).join('')
          : '<tr><td colspan="6" class="empty">No regularization requests.</td></tr>'}</tbody></table></div>`;
  } else if (ui.tab === 'employees') {
    panel = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h2>Employees</h2>
        <button class="btn primary sm" id="add-emp">+ Add employee</button></div>
      <table><thead><tr><th>Name</th><th>Email</th><th>Code</th><th>Department</th><th>Role</th><th class="num">Leave bal.</th><th>Status</th><th></th></tr></thead>
      <tbody>${DB.users.slice().sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'admin' ? -1 : 1)).map((e) => `<tr>
        <td><b>${esc(e.name)}</b></td><td class="muted small">${esc(e.email)}</td><td class="muted small">${esc(e.employee_code || '—')}</td>
        <td>${esc(e.department || '—')}</td>
        <td><span class="badge ${e.role === 'admin' ? 'role-admin' : 'present'}">${label(e.role)}</span></td>
        <td class="num">${e.leave_balance}</td><td><span class="badge ${e.status}">${label(e.status)}</span></td>
        <td>${e.id === me().id
          ? '<span class="muted small">This is you</span>'
          : `<button class="btn sm ghost" data-role="${e.id}" data-val="${e.role === 'admin' ? 'user' : 'admin'}">${e.role === 'admin' ? 'Make user' : 'Make admin'}</button>
        <button class="btn sm ghost" data-status="${e.id}" data-val="${e.status === 'active' ? 'inactive' : 'active'}">${e.status === 'active' ? 'Deactivate' : 'Activate'}</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  } else {
    const month = ui.repMonth;
    const recs = DB.users.filter((x) => x.role === 'user').map((e) => {
      const rows = DB.attendance.filter((a) => a.user_id === e.id && a.date.startsWith(month));
      return { e, present: rows.filter((r) => r.status === 'present').length, half: rows.filter((r) => r.status === 'half_day').length, absent: rows.filter((r) => r.status === 'absent').length, leave: rows.filter((r) => r.status === 'on_leave').length, hours: +(rows.reduce((a, r) => a + r.worked_minutes, 0) / 60).toFixed(2) };
    });
    const totals = recs.reduce((a, r) => ({ present: a.present + r.present, absent: a.absent + r.absent, hours: +(a.hours + r.hours).toFixed(2) }), { present: 0, absent: 0, hours: 0 });
    panel = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h2>Monthly summary</h2>
        <input type="month" id="rep-month" value="${month}" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px" /></div>
      <table><thead><tr><th>Employee</th><th>Department</th><th class="num">Present</th><th class="num">Half</th><th class="num">Absent</th><th class="num">Leave</th><th class="num">Hours</th></tr></thead>
      <tbody>${recs.map((r) => `<tr><td><b>${esc(r.e.name)}</b><div class="muted small">${esc(r.e.employee_code || '')}</div></td>
        <td>${esc(r.e.department || '—')}</td><td class="num">${r.present}</td><td class="num">${r.half}</td><td class="num">${r.absent}</td><td class="num">${r.leave}</td><td class="num">${r.hours}</td></tr>`).join('')}
      <tr style="font-weight:700;background:var(--brand-soft)"><td>Total</td><td></td><td class="num">${totals.present}</td><td class="num">—</td><td class="num">${totals.absent}</td><td class="num">—</td><td class="num">${totals.hours}</td></tr></tbody></table></div>`;
  }
  mainEl().innerHTML = head + panel;
  bindAdmin();
}

/* ----------------------------- binding ----------------------------- */
function startClock() {
  const tick = () => {
    const c = document.getElementById('live-clock');
    if (!c) return;
    const now = new Date();
    c.textContent = now.toLocaleTimeString('en-IN', { hour12: false });
    document.getElementById('live-date').textContent = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  tick();
  clearInterval(window._clock); window._clock = setInterval(tick, 1000);
}

function bindUser() {
  const b = document.getElementById('btn-in'); if (b) b.onclick = () => doPunch('in');
  const o = document.getElementById('btn-out'); if (o) o.onclick = () => doPunch('out');
  const hg = document.getElementById('hist-go');
  if (hg) hg.onclick = () => { ui.histFrom = document.getElementById('hist-from').value; ui.histTo = document.getElementById('hist-to').value; render(); };
  const ls = document.getElementById('lv-submit');
  if (ls) ls.onclick = () => applyLeave({ type: document.getElementById('lv-type').value, start_date: document.getElementById('lv-start').value, end_date: document.getElementById('lv-end').value, reason: document.getElementById('lv-reason').value });
  const rs = document.getElementById('rg-submit');
  if (rs) rs.onclick = () => raiseReg({ date: document.getElementById('rg-date').value, in: document.getElementById('rg-in').value, out: document.getElementById('rg-out').value, reason: document.getElementById('rg-reason').value });
  mainEl().querySelectorAll('[data-cancel]').forEach((el) => (el.onclick = () => cancelLeave(Number(el.dataset.cancel))));
}

function bindAdmin() {
  const r = document.getElementById('refresh'); if (r) r.onclick = () => { toast('Refreshed'); render(); };
  const ae = document.getElementById('add-emp'); if (ae) ae.onclick = openAdd;
  const rm = document.getElementById('rep-month'); if (rm) rm.onchange = () => { ui.repMonth = rm.value; render(); };
  mainEl().querySelectorAll('[data-lv]').forEach((el) => (el.onclick = () => reviewLeave(Number(el.dataset.lv), el.dataset.act)));
  mainEl().querySelectorAll('[data-rg]').forEach((el) => (el.onclick = () => reviewReg(Number(el.dataset.rg), el.dataset.act)));
  mainEl().querySelectorAll('[data-role]').forEach((el) => (el.onclick = () => patchEmployee(Number(el.dataset.role), { role: el.dataset.val })));
  mainEl().querySelectorAll('[data-status]').forEach((el) => (el.onclick = () => patchEmployee(Number(el.dataset.status), { status: el.dataset.val })));
}

function openModal(html) { document.getElementById('modal-body').innerHTML = html; document.getElementById('modal').classList.add('open'); }
function closeModal() { document.getElementById('modal').classList.remove('open'); }

function openAdd() {
  openModal(`<h2>Add employee</h2>
    <p class="small muted">The employee ID is generated automatically (${nextEmployeeCode()}).</p>
    <div class="field"><label>Full name</label><input id="e-name" placeholder="e.g. Meera Joshi" /></div>
    <div class="field"><label>Work email</label><input id="e-email" type="email" placeholder="name@vutto.in" /></div>
    <div class="row2"><div class="field"><label>Password</label><input id="e-pass" placeholder="Temp password" /></div>
    <div class="field"><label>Department</label><input id="e-dept" placeholder="Engineering" /></div></div>
    <div class="row2"><div class="field"><label>Role</label><select id="e-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
    <div class="field"><label>Leave balance (days)</label><input id="e-bal" type="number" value="18" /></div></div>
    <div class="foot"><button class="btn ghost" id="e-cancel">Cancel</button><button class="btn primary" id="e-save">Create</button></div>`);
  document.getElementById('e-cancel').onclick = closeModal;
  document.getElementById('e-save').onclick = () => addEmployee({
    name: document.getElementById('e-name').value.trim(),
    email: document.getElementById('e-email').value.trim(),
    password: document.getElementById('e-pass').value,
    department: document.getElementById('e-dept').value.trim() || null,
    role: document.getElementById('e-role').value,
    leave_balance: Number(document.getElementById('e-bal').value) || 18,
  });
}

/* ----------------------------- nav + boot ----------------------------- */
document.getElementById('nav-links').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]'); if (!btn) return;
  ui.tab = btn.dataset.tab; render();
});
document.getElementById('main').addEventListener('click', (e) => {
  const t = e.target.closest('button[data-atab]'); if (t) { ui.atab = t.dataset.atab; render(); }
});
document.getElementById('logout').onclick = () => { stopTracking(); DB.session = null; persist(); ui.tab = null; render(); };

document.getElementById('login-form').onsubmit = (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const u = DB.users.find((x) => x.email.toLowerCase() === email.toLowerCase() && x.password === password);
  if (!u) return toast('Invalid email or password', true);
  if (u.status !== 'active') return toast('This account has been deactivated. Contact your admin.', true);
  DB.session = u.id; persist();
  // Reset any stale tab from a previous session so the right console opens.
  ui.tab = u.role === 'admin' ? 'team' : 'home';
  ui.atab = 'leaves';
  render();
};
document.getElementById('fill-admin').onclick = () => { document.getElementById('email').value = 'admin@vutto.demo'; document.getElementById('password').value = 'Admin@123'; };
document.getElementById('fill-user').onclick = () => { document.getElementById('email').value = 'aarav@vutto.demo'; document.getElementById('password').value = 'User@123'; };

render();

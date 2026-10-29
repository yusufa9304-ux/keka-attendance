/* Vutto Attendance — the live app.
 *
 * All data lives in Supabase. A copy is held in memory so the screens can render
 * synchronously, exactly as they did before, and every write goes to the
 * database first: if the database refuses, the screen is not updated.
 *
 * What a person may see is decided by row level security in the database, not
 * here, so this file being readable is harmless.
 */

const WORK = { start: '09:30', fullDay: 480, halfDay: 240 };

const todayStr = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); };
const isWeekend = (ds) => { const g = new Date(ds + 'T00:00:00').getDay(); return g === 0 || g === 6; };
const dateRange = (a, b) => { const out = []; let c = a, g = 0; while (c <= b && g++ < 400) { out.push(c); c = addDays(c, 1); } return out; };
const workingDays = (a, b) => dateRange(a, b).filter((d) => !isWeekend(d)).length || 1;

/* Filled by SB.loadAll() once somebody is signed in. Empty until then, which is
   why nothing renders before the profile arrives. */
const DB = {
  users: [], sites: [], attendance: [], leaves: [], regularizations: [],
  location_pings: [], session: null, me: null,
};
/* sb.js is a separate script and fills this, and a top-level const is not a
   property of window on its own. */
window.DB = DB;

/* Pull the fresh copy and redraw. Every write ends with this. */
async function reload() {
  await SB.loadAll();
  render();
}

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
const me = () => DB.me || null;

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

/* ---- reporting lines (same rules as the server) ---- */
const teamIds = (u) => DB.users.filter((x) => x.manager_id === u.id && x.status === 'active').map((x) => x.id);
const isManager = (u) => !!u && u.role !== 'admin' && teamIds(u).length > 0;
const canConsole = (u) => !!u && (u.role === 'admin' || isManager(u));
/** May `viewer` approve or inspect `targetId`'s requests? Nobody approves their own. */
const canActFor = (viewer, targetId) => !!viewer
  && (viewer.role === 'admin' || (viewer.id !== targetId && teamIds(viewer).includes(targetId)));
const scopedEmployees = (u) => (u.role === 'admin'
  ? DB.users.filter((x) => x.role === 'user')
  : DB.users.filter((x) => teamIds(u).includes(x.id)));
const managerName = (u) => (u.manager_id ? (DB.users.find((x) => x.id === u.manager_id) || {}).name || null : null);
const pendingFor = (u) => DB.leaves.filter((l) => l.status === 'pending' && canActFor(u, l.user_id)).length
  + DB.regularizations.filter((r) => r.status === 'pending' && canActFor(u, r.user_id)).length;

/** The tab strip. Everyone gets their own day; console users get the team tabs. */
/* The tab strip. The buttons are updated in place rather than rebuilt, because
   rebuilding destroys the sliding pill and leaves it nowhere to travel from. */
function renderNav(tabs) {
  const links = document.getElementById('nav-links');
  const wanted = tabs.map(([k]) => k).join(',');
  if (links.dataset.tabs !== wanted) {
    links.innerHTML = tabs.map(([k]) => `<button data-tab="${k}"></button>`).join('');
    links.dataset.tabs = wanted;
    if (window.syncNavPillNow) window.syncNavPillNow(links);
  }
  links.querySelectorAll('button').forEach((b) => {
    const t = tabs.find(([k]) => k === b.dataset.tab);
    const label = t ? t[1] : '';
    if (b.innerHTML !== label) b.innerHTML = label;
    b.classList.toggle('active', b.dataset.tab === ui.tab);
  });
  if (window.syncNavPill) window.syncNavPill(links);
}

function navTabs(u) {
  const admin = u.role === 'admin';
  const tabs = [];
  if (!admin) tabs.push(['home', 'My Day'], ['history', 'Attendance'], ['leave', 'Leaves'], ['reg', 'Regularization']);
  if (canConsole(u)) {
    const n = pendingFor(u);
    tabs.push(['team', admin ? 'Team Today' : 'My Team'], ['locations', 'Locations'],
      ['approvals', `Approvals ${n ? `<span class="badge pending">${n}</span>` : ''}`]);
  }
  if (admin) tabs.push(['employees', 'Employees'], ['sites', 'Sites'], ['reports', 'Reports']);
  return tabs;
}

/* ---- geofence + fake-GPS helpers (same logic as the server) ---- */
const siteForUser = (u) => (u && u.site_id ? DB.sites.find((s) => s.id === u.site_id && s.active !== false) || null : null);
const recentPings = (uid, date = todayStr(), limit = 6) => DB.location_pings
  .filter((p) => p.user_id === uid && p.date === date)
  .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))
  .slice(0, limit);

function judge(u, pos) {
  const geo = VUTTO_GEO.evaluateGeofence(siteForUser(u), pos.lat, pos.lng);
  const spoof = VUTTO_GEO.scoreSpoof({
    lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy,
    clientTs: pos.ts, prev: recentPings(u.id), now: Date.now(),
  });
  return { geo, spoof };
}

async function addPing(u, pos) {
  await SB.ping(u.id, pos.lat, pos.lng, pos.accuracy ?? null);
}

async function doPunch(kind) {
  const u = me();
  try {
    const proof = await CAPTURE.punchProof((msg) => toast(msg));
    const now = new Date().toISOString();
    const date = todayStr();
    const { geo, spoof } = judge(u, proof);

    if (kind === 'in') {
      let r = todayRow(u.id);
      if (r && r.clock_in) { toast('You have already clocked in today', true); return render(); }
      const geoFields = {
        in_site_id: geo ? geo.site_id : null,
        in_distance_m: geo ? geo.distance_m : null,
        in_inside: geo ? geo.inside : null,
        in_spoof_score: spoof.score,
        in_spoof_flags: spoof.flags,
      };
      await SB.punch({
        userId: u.id, kind,
        lat: proof.lat, lng: proof.lng, address: proof.address,
        siteId: geo ? geo.site_id : null,
        inside: geo ? geo.inside : null,
        photoRef: proof.photo || null,
        photoStore: proof.photo ? 'inline' : null,
        spoof,
      });
      await addPing(u, date, proof, 'punch', now, { geo, spoof });
      toast('Clocked in — photo + location saved');
    } else {
      const r = todayRow(u.id);
      if (!r || !r.clock_in) { toast('You need to clock in first', true); return render(); }
      if (r.clock_out) { toast('You have already clocked out today', true); return render(); }
      const worked = Math.max(0, Math.round((new Date(now) - new Date(r.clock_in)) / 60000));
      await SB.punch({
        userId: u.id, kind,
        lat: proof.lat, lng: proof.lng, address: proof.address,
        siteId: geo ? geo.site_id : null,
        inside: geo ? geo.inside : null,
        photoRef: proof.photo || null,
        photoStore: proof.photo ? 'inline' : null,
        spoof,
        workedMinutes: worked,
        status: worked < WORK.halfDay ? 'half_day' : 'present',
      });
      await addPing(u, date, proof, 'punch', now, { geo, spoof });
      toast('Clocked out — photo + location saved');
    }

    if (geo && !geo.inside) toast(VUTTO_GEO.describeGeofence(geo), true);
    else if (spoof.suspected) toast('Heads up: your location looked unusual — this punch is flagged for review.', true);

    await reload();
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
    try { await addPing(u, pos); } catch (e) { console.warn('location update failed', e.message); }
  });
}
function stopTracking() { if (tracker) { tracker.stop(); tracker = null; } }

const PIN_SVG = '<svg class="pin-ico" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">'
  + '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>';

const mapsUrl = (lat, lng) => (lat != null ? `https://www.google.com/maps?q=${lat},${lng}` : null);
const fmtCoords = (lat, lng) => `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;

/** "at <site>" / "outside <site>" / "Field" plus any GPS flag, for one attendance row. */
function siteCell(a) {
  if (!a) return '<span class="muted small">—</span>';
  const s = DB.sites.find((x) => x.id === a.in_site_id);
  const parts = [];
  if (a.in_site_id == null) parts.push('<span class="muted small">Field (no site)</span>');
  else if (a.in_inside === false) parts.push(`<span class="badge absent">⚠ outside ${esc(s ? s.name : 'site')}</span>`);
  else parts.push(`<span class="badge present">✓ at ${esc(s ? s.name : 'site')}</span>`);
  const score = Math.max(a.in_spoof_score || 0, a.out_spoof_score || 0);
  if (score >= 50) parts.push(`<span class="badge pending">⚠ GPS ${score}</span>`);
  return parts.join(' ');
}

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
async function applyLeave(body) {
  const u = me();
  if (!body.start_date || !body.end_date) return toast('Please pick both dates', true);
  if (body.end_date < body.start_date) return toast('End date cannot be before start date', true);
  const days = workingDays(body.start_date, body.end_date);
  try {
    await SB.applyLeave(u.id, body.type, body.start_date, body.end_date, body.reason || null);
    toast(`Leave request submitted (${days} day${days > 1 ? 's' : ''})`);
    await reload();
  } catch (e) { toast(e.message, true); }
}
async function cancelLeave(id) {
  const u = me();
  const l = DB.leaves.find((x) => x.id === id && x.user_id === u.id);
  if (!l) return;
  if (l.status !== 'pending') return toast('Only pending requests can be cancelled', true);
  try {
    await SB.cancelLeave(id);
    toast('Request cancelled');
    await reload();
  } catch (e) { toast(e.message, true); }
}
async function raiseReg(body) {
  const u = me();
  if (!body.date || !body.reason) return toast('Date and reason are required', true);
  try {
    await SB.raiseRegularization(u.id, body.date, body.in || null, body.out || null, body.reason);
    toast('Regularization request submitted');
    await reload();
  } catch (e) { toast(e.message, true); }
}

async function reviewLeave(id, action) {
  const l = DB.leaves.find((x) => x.id === id);
  if (!l || l.status !== 'pending') return toast('This request has already been reviewed', true);
  if (!canActFor(me(), l.user_id)) return toast('This request is not in your team', true);
  const next = action === 'approve' ? 'approved' : 'rejected';
  try {
    await SB.decideLeave(l.id, next);
    toast(`Leave ${next}`);
    await reload();
  } catch (e) { toast(e.message, true); }
}
async function reviewReg(id, action) {
  const r = DB.regularizations.find((x) => x.id === id);
  if (!r || r.status !== 'pending') return toast('This request has already been reviewed', true);
  if (!canActFor(me(), r.user_id)) return toast('This request is not in your team', true);
  const next = action === 'approve' ? 'approved' : 'rejected';
  try {
    await SB.decideRegularization(r.id, next);
    toast(`Regularization ${next}`);
    await reload();
  } catch (e) { toast(e.message, true); }
}
function nextEmployeeCode() {
  let max = 0;
  for (const u of DB.users) {
    const n = parseInt(String(u.employee_code || '').replace(/\D+/g, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `VUT-${String(max + 1).padStart(4, '0')}`;
}

/* No password column any more: people sign in with Google, and the admin adding
   the address here is what lets them in. The employee code is issued by the
   database so two admins adding someone at once cannot collide. */
async function addEmployee(body) {
  if (!body.name || !body.email) return toast('Name and email are required', true);
  if (DB.users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) return toast('An account with this email already exists', true);
  try {
    await SB.saveEmployee({
      name: body.name,
      email: String(body.email).toLowerCase(),
      role: body.role || 'user',
      department: body.department || null,
      leave_balance: body.leave_balance ?? 18,
      site_id: body.site_id ?? null,
      manager_id: body.manager_id ?? null,
    });
    toast('Employee added — they can sign in with Google now');
    closeModal();
    await reload();
  } catch (e) { toast(e.message, true); }
}
async function setManager(id, managerId) {
  if (managerId === id) return toast('Someone cannot report to themselves', true);
  // Walk the chain up: the new manager must not report back to this person.
  let cur = managerId, hops = 0;
  while (cur && hops++ < 25) {
    if (cur === id) return toast('That would create a reporting loop', true);
    cur = (DB.users.find((x) => x.id === cur) || {}).manager_id ?? null;
  }
  const e = DB.users.find((x) => x.id === id);
  if (!e) return;
  try {
    await SB.saveEmployee({ manager_id: managerId }, id);
    toast(managerId ? 'Reporting manager updated' : 'Reporting manager cleared');
    await reload();
  } catch (err) { toast(err.message, true); }
}

async function patchEmployee(id, patch) {
  const u = DB.users.find((x) => x.id === id);
  if (!u) return;
  // Never let an admin lock themselves out of the admin console.
  const self = me();
  if (self && id === self.id) {
    if (patch.role && patch.role !== 'admin') return toast("You can't change your own role — ask another admin.", true);
    if (patch.status && patch.status !== 'active') return toast("You can't deactivate your own account.", true);
  }
  try {
    await SB.saveEmployee(patch, id);
    toast('Employee updated');
    await reload();
  } catch (err) { toast(err.message, true); }
}

/* ----------------------------- rendering ----------------------------- */
const appEl = () => document.getElementById('app-view');
const mainEl = () => document.getElementById('main');

/* Keep wide tables inside their card: the table keeps its natural column
   widths, and only the wrapper scrolls. */
function wrapTables(root) {
  root.querySelectorAll('.card > table').forEach((t) => {
    const w = document.createElement('div');
    w.className = 'tbl-scroll';
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
  });
}

function render() {
  const u = me();
  if (!u) { document.getElementById('login-view').classList.remove('hidden'); appEl().classList.add('hidden'); return; }
  document.getElementById('login-view').classList.add('hidden');
  appEl().classList.remove('hidden');

  document.getElementById('nav-avatar').textContent = initials(u.name);
  document.getElementById('nav-name').textContent = u.name;
  document.getElementById('nav-role').textContent = u.role === 'admin'
    ? 'Administrator'
    : isManager(u) ? (u.department ? `${u.department} · Manager` : 'Manager')
      : (u.department ? `${u.department} · Employee` : 'Employee');
  const tag = document.getElementById('admin-tag');
  if (tag) {
    // Set the classes first: assigning className replaces the whole list, so
    // adding 'hidden' before it would be wiped straight back out.
    tag.className = u.role === 'admin' ? 'badge role-admin' : 'badge working';
    tag.textContent = u.role === 'admin' ? 'Admin' : 'Manager';
    tag.classList.toggle('hidden', !canConsole(u));
  }

  const consoleTab = ['team', 'locations', 'approvals', 'employees', 'sites', 'reports'].includes(ui.tab);
  if (consoleTab && canConsole(u)) renderAdmin(); else renderUser();
}

function renderUser() {
  const u = me();
  if (!ui.tab) ui.tab = 'home';
  const tabs = navTabs(u);
  renderNav(tabs);

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
      <span class="loc"><span class="pin">${PIN_SVG}</span> <a href="${mapsUrl(lat, lng)}" target="_blank" rel="noopener">${esc(addr)}</a></span>
    </div>`;
  };
  const geoBadge = (r, kind) => {
    const inside = kind === 'in' ? r.in_inside : r.out_inside;
    const dist = kind === 'in' ? r.in_distance_m : r.out_distance_m;
    const sid = kind === 'in' ? r.in_site_id : r.out_site_id;
    if (dist == null) return '';
    const s = DB.sites.find((x) => x.id === sid);
    const name = s ? s.name : 'assigned site';
    const d = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
    return inside
      ? `<span class="badge present">✓ inside ${esc(name)} (${d})</span>`
      : `<span class="badge absent">⚠ ${d} from ${esc(name)}</span>`;
  };
  const spoofBadge = (r, kind) => {
    const score = (kind === 'in' ? r.in_spoof_score : r.out_spoof_score) || 0;
    return score >= 50 ? `<span class="badge pending">GPS check ${score}/100</span>` : '';
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
      ${t && t.in_distance_m != null ? `<div style="margin-top:10px">${geoBadge(t, 'in')} ${spoofBadge(t, 'in')}</div>` : ''}
      ${t && t.out_distance_m != null ? `<div style="margin-top:6px">${geoBadge(t, 'out')} ${spoofBadge(t, 'out')}</div>` : ''}
      ${!t && siteForUser(u) ? `<div class="track-note" style="margin-top:14px">You are checked against <b>${esc(siteForUser(u).name)}</b> — punch within ${siteForUser(u).radius_m} m.</div>` : ''}
      <div class="small muted" style="margin-top:10px">${managerName(u) ? `Reporting to <b>${esc(managerName(u))}</b>` : 'No reporting manager set'}</div>
      <div class="track-note">${onClock
        ? `${PIN_SVG} On the clock — location updates every ${PING_MIN} min (${pingsToday} update${pingsToday === 1 ? '' : 's'} so far today).`
        : `${PIN_SVG} Location + a selfie are required for every punch. ${pingsToday ? pingsToday + ' location update(s) recorded today.' : ''}`}</div>
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
      <div class="card"><table><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th class="num">Worked</th><th>Photo</th><th>Check-in location</th><th>Site / GPS</th><th>Status</th></tr></thead>
      <tbody>${recs.length ? recs.map((r) => `<tr>
        <td>${fmtDate(r.date)}</td>
        <td>${fmtTime(r.clock_in)}${r.clock_in && r.clock_in.slice(11, 16) > WORK.start ? ' <span class="badge half_day" style="font-size:.7rem">late</span>' : ''}</td>
        <td>${fmtTime(r.clock_out)}</td>
        <td class="num">${r.worked_minutes ? fmtHours(r.worked_minutes / 60) : '—'}</td>
        <td>${r.in_photo ? `<img class="punch-photo" src="${r.in_photo}" alt="in" onclick="viewPhoto(this.src)" />` : '<span class="muted small">—</span>'}</td>
        <td class="small">${r.in_lat != null ? `<a href="${mapsUrl(r.in_lat, r.in_lng)}" target="_blank" rel="noopener"><span class="pin">${PIN_SVG}</span> ${esc(r.in_address || fmtCoords(r.in_lat, r.in_lng))}</a>` : '<span class="muted">—</span>'}</td>
        <td>${siteCell(r)}</td>
        <td><span class="badge ${r.status}">${label(r.status)}</span></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No records in this range.</td></tr>'}</tbody></table></div>`;
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
  wrapTables(mainEl());
  bindUser();
  startClock();
}

function renderAdmin() {
  const u = me();
  if (!ui.tab || !['team', 'locations', 'approvals', 'employees', 'sites', 'reports'].includes(ui.tab)) ui.tab = 'team';
  if (!ui.atab) ui.atab = 'leaves';
  // Everything below is limited to what this viewer may see.
  const mine = (uid) => canActFor(u, uid);
  const pendingLeaves = DB.leaves.filter((l) => l.status === 'pending' && mine(l.user_id)).length;
  const pendingRegs = DB.regularizations.filter((r) => r.status === 'pending' && mine(r.user_id)).length;
  const pending = pendingLeaves + pendingRegs;
  const pendingRegByUser = {};
  for (const r of DB.regularizations) if (r.status === 'pending' && mine(r.user_id)) pendingRegByUser[r.user_id] = (pendingRegByUser[r.user_id] || 0) + 1;
  const tabs = navTabs(u);
  renderNav(tabs);

  const date = todayStr();
  const emps = scopedEmployees(u).filter((x) => x.status === 'active');
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
    </div>
    ${pending ? `<div class="card pending-card" style="margin-bottom:18px;border-color:var(--brand-mid)">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span class="badge pending">${pending}</span>
        <b>pending approval${pending > 1 ? 's' : ''}</b>
        <span class="muted small">waiting for you</span>
        <span style="flex:1"></span>
        ${pendingLeaves ? `<button class="btn ghost sm" data-goto="leaves">Leave requests (${pendingLeaves})</button>` : ''}
        ${pendingRegs ? `<button class="btn primary sm" data-goto="regs">Regularizations (${pendingRegs})</button>` : ''}
      </div>
    </div>` : ''}`;

  let panel = '';
  const locCell = (lat, lng, address) => (lat != null
    ? `<a href="${mapsUrl(lat, lng)}" target="_blank" rel="noopener" class="small"><span class="pin">${PIN_SVG}</span> ${esc(address || fmtCoords(lat, lng))}</a>`
    : '<span class="muted small">—</span>');
  const photoCell = (src) => (src
    ? `<img class="punch-photo" src="${src}" alt="punch photo" onclick="viewPhoto(this.src)" />`
    : '<span class="muted small">—</span>');
  const managerSelect = (e) => `<select data-mgr-set="${e.id}" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:inherit;max-width:190px">
      <option value="none"${e.manager_id == null ? ' selected' : ''}>— nobody (reports to admin) —</option>
      ${DB.users.filter((m) => m.id !== e.id).map((m) => `<option value="${m.id}"${e.manager_id === m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}
    </select>`;
  const siteSelect = (e) => `<select data-site-set="${e.id}" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:inherit;max-width:190px">
      <option value="field"${e.site_id == null ? ' selected' : ''}>Field (no site)</option>
      ${DB.sites.map((s) => `<option value="${s.id}"${e.site_id === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
    </select>`;
  if (ui.tab === 'team') {
    panel = `<div class="card"><h2>Team status — today</h2>
      <table><thead><tr><th>Employee</th><th>Department</th><th>Clock in</th><th>Clock out</th><th class="num">Worked</th><th>Photo</th><th>Check-in location</th><th>Site / GPS</th><th>State</th></tr></thead>
      <tbody>${team.length ? team.map(({ e, a, state }) => `<tr>
        <td><b>${esc(e.name)}</b>${pendingRegByUser[e.id] ? ` <span class="badge pending" title="pending regularization">${pendingRegByUser[e.id]} pending</span>` : ''}<div class="muted small">${esc(e.employee_code || '')}</div></td>
        <td>${esc(e.department || '—')}</td><td>${fmtTime(a && a.clock_in)}</td><td>${fmtTime(a && a.clock_out)}</td>
        <td class="num">${a && a.worked_minutes ? fmtHours(a.worked_minutes / 60) : '—'}</td>
        <td>${photoCell(a && a.in_photo)}</td>
        <td>${locCell(a && a.in_lat, a && a.in_lng, a && a.in_address)}</td>
        <td>${siteCell(a)}</td>
        <td><span class="badge ${state}">${label(state)}</span></td></tr>`).join('') : '<tr><td colspan="9" class="empty">No employees yet.</td></tr>'}</tbody></table></div>`;
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
        <td><b>${esc(e.name)}</b>${siteCell(a)}<div class="muted small">${esc(e.employee_code || '')}</div></td>
        <td>${onClock ? '<span class="badge working">On clock</span>' : (a && a.clock_out ? '<span class="badge done">Clocked out</span>' : '<span class="badge not_in">Not in</span>')}</td>
        <td>${locCell(a && a.in_lat, a && a.in_lng, a && a.in_address)}</td>
        <td class="small">${latest ? fmtTime(latest.captured_at) : '<span class="muted">—</span>'}</td>
        <td>${latest ? locCell(latest.lat, latest.lng, latest.address) : '<span class="muted small">—</span>'}</td>
        <td class="num">${count}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (ui.tab === 'approvals') {
    const leaves = DB.leaves.filter((l) => mine(l.user_id)).sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.id - a.id);
    const regs = DB.regularizations.filter((r) => mine(r.user_id)).sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.id - a.id);
    panel = `<div class="tabs">
        <button data-atab="leaves" class="${ui.atab === 'leaves' ? 'active' : ''}">Leave requests ${pendingLeaves ? `<span class="badge pending">${pendingLeaves}</span>` : ''}</button>
        <button data-atab="regs" class="${ui.atab === 'regs' ? 'active' : ''}">Regularizations ${pendingRegs ? `<span class="badge pending">${pendingRegs}</span>` : ''}</button>
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
      <table><thead><tr><th>Name</th><th>Email</th><th>Code</th><th>Department</th><th>Reporting manager</th><th>Site</th><th>Role</th><th class="num">Leave bal.</th><th>Status</th><th></th></tr></thead>
      <tbody>${DB.users.slice().sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'admin' ? -1 : 1)).map((e) => `<tr>
        <td><b>${esc(e.name)}</b></td><td class="muted small">${esc(e.email)}</td><td class="muted small">${esc(e.employee_code || '—')}</td>
        <td>${esc(e.department || '—')}</td>
        <td>${managerSelect(e)}</td>
        <td>${siteSelect(e)}</td>
        <td><span class="badge ${e.role === 'admin' ? 'role-admin' : 'present'}">${label(e.role)}</span></td>
        <td class="num">${e.leave_balance}</td><td><span class="badge ${e.status}">${label(e.status)}</span></td>
        <td>${e.id === me().id
          ? '<span class="muted small">This is you</span>'
          : `<button class="btn sm ghost" data-role="${e.id}" data-val="${e.role === 'admin' ? 'user' : 'admin'}">${e.role === 'admin' ? 'Make user' : 'Make admin'}</button>
        <button class="btn sm ghost" data-status="${e.id}" data-val="${e.status === 'active' ? 'inactive' : 'active'}">${e.status === 'active' ? 'Deactivate' : 'Activate'}</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (ui.tab === 'sites') {
    panel = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap">
        <h2>Showrooms &amp; geofences</h2>
        <button class="btn primary sm" id="add-site">+ Add site</button>
      </div>
      <p class="small muted">Every punch is checked against the employee's assigned site. Field staff have no site and are not geofenced.</p>
      <table><thead><tr><th>Site</th><th class="num">Radius</th><th>Map</th><th class="num">Staff</th><th>Status</th><th></th></tr></thead>
      <tbody>${DB.sites.map((s) => {
        const staff = DB.users.filter((x) => x.site_id === s.id && x.role === 'user');
        return `<tr>
          <td><b>${esc(s.name)}</b><div class="muted small">${esc(s.address || '')}</div></td>
          <td class="num">${s.radius_m} m</td>
          <td>${s.lat != null ? `<a href="${mapsUrl(s.lat, s.lng)}" target="_blank" rel="noopener" class="small"><span class="pin">${PIN_SVG}</span> map</a>` : '—'}</td>
          <td class="num">${staff.length}</td>
          <td>${s.active === false ? '<span class="badge inactive">Inactive</span>' : '<span class="badge active">Active</span>'}</td>
          <td><button class="btn sm ghost" data-site-toggle="${s.id}">${s.active === false ? 'Activate' : 'Deactivate'}</button>
          <button class="btn sm ghost" data-site-del="${s.id}">Delete</button></td></tr>`;
      }).join('')}</tbody></table>
    </div>`;
  } else {
    const month = ui.repMonth;
    const recs = DB.users.filter((x) => x.role === 'user').map((e) => {
      const rows = DB.attendance.filter((a) => a.user_id === e.id && a.date.startsWith(month));
      return { e, present: rows.filter((r) => r.status === 'present').length, half: rows.filter((r) => r.status === 'half_day').length, absent: rows.filter((r) => r.status === 'absent').length, leave: rows.filter((r) => r.status === 'on_leave').length, hours: +(rows.reduce((a, r) => a + r.worked_minutes, 0) / 60).toFixed(2) };
    });
    const totals = recs.reduce((a, r) => ({ present: a.present + r.present, absent: a.absent + r.absent, hours: +(a.hours + r.hours).toFixed(2) }), { present: 0, absent: 0, hours: 0 });
    panel = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;flex-wrap:wrap"><h2>Monthly summary</h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="month" id="rep-month" value="${month}" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px" />
          <button class="btn sm" id="export-csv">↓ CSV</button>
          <button class="btn sm primary" id="export-xlsx">↓ Excel</button>
        </div></div>
      <p class="small muted">Payroll-ready sheet — present days, LOP, payable days, hours, overtime, late marks, geofence violations and GPS flags.</p>
      <table><thead><tr><th>Employee</th><th>Department</th><th class="num">Present</th><th class="num">Half</th><th class="num">Absent</th><th class="num">Leave</th><th class="num">Hours</th></tr></thead>
      <tbody>${recs.map((r) => `<tr><td><b>${esc(r.e.name)}</b><div class="muted small">${esc(r.e.employee_code || '')}</div></td>
        <td>${esc(r.e.department || '—')}</td><td class="num">${r.present}</td><td class="num">${r.half}</td><td class="num">${r.absent}</td><td class="num">${r.leave}</td><td class="num">${r.hours}</td></tr>`).join('')}
      <tr style="font-weight:700;background:var(--brand-soft)"><td>Total</td><td></td><td class="num">${totals.present}</td><td class="num">—</td><td class="num">${totals.absent}</td><td class="num">—</td><td class="num">${totals.hours}</td></tr></tbody></table></div>`;
  }
  // The stat tiles and the pending card belong to Team Today. On the other tabs
  // they sat above unrelated content and read as the wrong page.
  const TITLES = {
    team: 'Team dashboard', locations: 'Live locations', approvals: 'Approvals',
    employees: 'Employees', sites: 'Showrooms & geofences', reports: 'Monthly summary',
  };
  const pageHead = ui.tab === 'team' ? head : `
    <div class="page-head">
      <div><h1>${TITLES[ui.tab] || 'Console'}</h1><p class="muted">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <button class="btn" id="refresh">↻ Refresh</button>
    </div>`;
  mainEl().innerHTML = pageHead + panel;
  wrapTables(mainEl());
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

/* ---- payroll (mirrors src/payroll.js) ---- */
const PAYROLL_COLUMNS = ['Employee Code', 'Employee', 'Department', 'Site',
  'Present', 'Half days', 'Absent', 'Paid leave', 'Unpaid leave (LOP)',
  'Payable days', 'Worked hours', 'Overtime hours', 'Late marks',
  'Outside geofence', 'GPS flags'];

function payrollRows(month) {
  const unpaid = {};
  for (const l of DB.leaves) {
    if (l.status !== 'approved' || l.type !== 'unpaid') continue;
    if (l.start_date > month + '-31' || l.end_date < month + '-01') continue;
    const days = dateRange(l.start_date, l.end_date).filter((d) => d.startsWith(month) && !isWeekend(d)).length;
    unpaid[l.user_id] = (unpaid[l.user_id] || 0) + days;
  }
  return DB.users.filter((u) => u.role === 'user').map((u) => {
    const rows = DB.attendance.filter((a) => a.user_id === u.id && a.date.startsWith(month));
    const n = (f) => rows.filter(f).length;
    const present = n((r) => r.status === 'present');
    const half = n((r) => r.status === 'half_day');
    const absent = n((r) => r.status === 'absent');
    const onLeave = n((r) => r.status === 'on_leave');
    const lop = unpaid[u.id] || 0;
    const paidLeave = Math.max(0, onLeave - lop);
    const totalMin = rows.reduce((a, r) => a + (r.worked_minutes || 0), 0);
    const otMin = rows.reduce((a, r) => a + Math.max(0, (r.worked_minutes || 0) - 480), 0);
    const site = DB.sites.find((s) => s.id === u.site_id);
    return {
      code: u.employee_code || '', name: u.name, dept: u.department || '', site: site ? site.name : 'Field',
      present, half, absent, paidLeave, lop,
      payable: +(present + half * 0.5 + paidLeave).toFixed(1),
      hours: +(totalMin / 60).toFixed(2), ot: +(otMin / 60).toFixed(2),
      late: n((r) => r.clock_in && r.clock_in.slice(11, 16) > '09:30'),
      outside: n((r) => r.in_inside === false || r.out_inside === false),
      flagged: n((r) => (r.in_spoof_score || 0) >= 50 || (r.out_spoof_score || 0) >= 50),
    };
  });
}

function payrollMatrix(month) {
  return [PAYROLL_COLUMNS, ...payrollRows(month).map((r) => [
    r.code, r.name, r.dept, r.site, r.present, r.half, r.absent, r.paidLeave, r.lop,
    r.payable, r.hours, r.ot, r.late, r.outside, r.flagged,
  ])];
}

function downloadBytes(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---- sites ---- */
async function toggleSite(id) {
  const s = DB.sites.find((x) => x.id === id);
  if (!s) return;
  const next = s.active === false;
  try {
    await SB.saveSite({ active: next }, id);
    toast(next ? 'Site activated' : 'Site deactivated');
    await reload();
  } catch (e) { toast(e.message, true); }
}
async function deleteSite(id) {
  if (!window.confirm('Delete this site? Its employees become field staff.')) return;
  try {
    await SB.deleteSite(id);
    toast('Site deleted');
    await reload();
  } catch (e) { toast(e.message, true); }
}
async function addSite(body) {
  if (!body.name) return toast('A name is required', true);
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return toast('Latitude and longitude are required', true);
  try {
    await SB.saveSite({
      name: body.name, address: body.address || null,
      lat, lng, radius_m: Number(body.radius_m) || 250, active: true,
    });
    toast('Site added');
    closeModal();
    await reload();
  } catch (e) { toast(e.message, true); }
}
function openAddSite() {
  openModal(`<h2>Add site</h2>
    <p class="small muted">Tip: open the showroom in Google Maps, long-press the pin and copy the coordinates.</p>
    <div class="field"><label>Name</label><input id="s-name" placeholder="Vutto Showroom — Jaipur" /></div>
    <div class="field"><label>Address</label><input id="s-addr" placeholder="Tonk Road, Jaipur" /></div>
    <div class="row2">
      <div class="field"><label>Latitude</label><input id="s-lat" placeholder="26.8467" /></div>
      <div class="field"><label>Longitude</label><input id="s-lng" placeholder="75.8020" /></div>
    </div>
    <div class="field"><label>Allowed radius (metres)</label><input id="s-rad" type="number" value="250" /></div>
    <div class="foot"><button class="btn ghost" id="s-cancel">Cancel</button><button class="btn primary" id="s-save">Create</button></div>`);
  document.getElementById('s-cancel').onclick = closeModal;
  document.getElementById('s-save').onclick = () => addSite({
    name: document.getElementById('s-name').value.trim(),
    address: document.getElementById('s-addr').value.trim(),
    lat: document.getElementById('s-lat').value,
    lng: document.getElementById('s-lng').value,
    radius_m: document.getElementById('s-rad').value,
  });
}

function bindAdmin() {
  const r = document.getElementById('refresh'); if (r) r.onclick = () => { toast('Refreshed'); render(); };
  const ec = document.getElementById('export-csv');
  if (ec) ec.onclick = () => {
    downloadBytes(VUTTO_XLSX.buildCsv(payrollMatrix(ui.repMonth)), `vutto-payroll-${ui.repMonth}.csv`, 'text/csv;charset=utf-8');
    toast('Payroll CSV downloaded');
  };
  const ex = document.getElementById('export-xlsx');
  if (ex) ex.onclick = () => {
    downloadBytes(VUTTO_XLSX.buildXlsx(`Payroll ${ui.repMonth}`, payrollMatrix(ui.repMonth)),
      `vutto-payroll-${ui.repMonth}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast('Payroll Excel downloaded');
  };
  const as = document.getElementById('add-site'); if (as) as.onclick = openAddSite;
  mainEl().querySelectorAll('[data-site-toggle]').forEach((el) => (el.onclick = () => toggleSite(Number(el.dataset.siteToggle))));
  mainEl().querySelectorAll('[data-site-del]').forEach((el) => (el.onclick = () => deleteSite(Number(el.dataset.siteDel))));
  mainEl().querySelectorAll('[data-site-set]').forEach((el) => (el.onchange = () => patchEmployee(Number(el.dataset.siteSet), { site_id: el.value === 'field' ? null : Number(el.value) })));
  mainEl().querySelectorAll('[data-mgr-set]').forEach((el) => (el.onchange = () => setManager(Number(el.dataset.mgrSet), el.value === 'none' ? null : Number(el.value))));
  mainEl().querySelectorAll('[data-goto]').forEach((el) => (el.onclick = () => {
    ui.tab = 'approvals'; ui.atab = el.dataset.goto; render();
  }));
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
    <div class="field"><label>Site (geofence)</label><select id="e-site"><option value="field">Field (no site)</option>${DB.sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="foot"><button class="btn ghost" id="e-cancel">Cancel</button><button class="btn primary" id="e-save">Create</button></div>`);
  document.getElementById('e-cancel').onclick = closeModal;
  document.getElementById('e-save').onclick = () => addEmployee({
    name: document.getElementById('e-name').value.trim(),
    email: document.getElementById('e-email').value.trim(),
    password: document.getElementById('e-pass').value,
    department: document.getElementById('e-dept').value.trim() || null,
    role: document.getElementById('e-role').value,
    leave_balance: Number(document.getElementById('e-bal').value) || 18,
    site_id: (function () { const v = document.getElementById('e-site').value; return v === 'field' ? null : Number(v); })(),
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
/* ---------------- view switching ---------------- */
function showSignedOut(note) {
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
  const n = document.getElementById('login-note');
  if (n) {
    n.textContent = note || 'Continue with your Vutto Google account.';
    n.classList.toggle('warn', !!note);
  }
}
function showSignedIn() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
}

/* ---------------- signing in and out ---------------- */
document.getElementById('logout').onclick = async () => {
  stopTracking();
  DB.me = null;
  ui.tab = null;
  await SB.signOut();
  showSignedOut();
};

const gbtn = document.getElementById('google-signin');
if (gbtn) gbtn.onclick = () => {
  gbtn.disabled = true;
  SB.signInWithGoogle().catch((err) => { gbtn.disabled = false; toast(err.message, true); });
};

/* ---------------- boot ----------------
 * Strict sign-in: a Google account only gets in if an admin has already added
 * that address. Anyone else is signed straight back out with a clear reason,
 * rather than being left staring at an empty console.
 */
async function enterApp() {
  const profile = await SB.me();
  if (!profile) {
    await SB.signOut();
    showSignedOut('That account is not on the Vutto Attendance list yet. Ask an admin to add you, then try again.');
    return;
  }
  if (profile.status !== 'active') {
    await SB.signOut();
    showSignedOut('Your account has been deactivated. Contact your admin.');
    return;
  }
  DB.me = profile;
  ui.tab = profile.role === 'admin' ? 'team' : 'home';
  ui.atab = 'leaves';
  await SB.loadAll();
  showSignedIn();
  render();
}

async function boot() {
  try {
    const session = await SB.session();
    if (session) await enterApp();
    else showSignedOut();
  } catch (err) {
    // Not necessarily the network: anything thrown while loading the profile
    // lands here, so say what actually happened instead of blaming the wifi.
    console.error(err);
    showSignedOut('Something went wrong while signing you in. Tap "Reset it" below, then try again.');
  }
}

/* Google hands control back to this page, so the session can also appear
   without a reload. */
SB.onAuthChange((session) => {
  if (session && !DB.me) enterApp();
  if (!session && DB.me) { DB.me = null; showSignedOut(); }
});

boot();

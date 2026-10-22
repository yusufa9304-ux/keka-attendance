let ME = null;

(async function init() {
  ME = await currentUser();
  if (!ME) return (location.href = '/');
  if (!ME.can_console) return (location.href = '/dashboard');
  const isAdmin = ME.role === 'admin';
  // A reporting manager gets the team screens only, not company-wide settings.
  if (!isAdmin) {
    document.querySelectorAll('[data-admin-only]').forEach((b) => b.classList.add('hidden'));
    document.querySelectorAll('[data-panel="employees"], [data-panel="sites"], [data-panel="reports"]')
      .forEach((p) => p.classList.add('hidden'));
    const badge = document.getElementById('nav-role-badge');
    if (badge) { badge.textContent = 'Manager'; badge.className = 'badge working'; }
    const h = document.getElementById('team-heading');
    if (h) h.textContent = `My team — today (${ME.reports} ${ME.reports === 1 ? 'person' : 'people'})`;
  }

  document.getElementById('nav-avatar').textContent = initials(ME.name);
  document.getElementById('nav-name').textContent = ME.name;
  document.getElementById('head-date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('rep-month').value = new Date().toISOString().slice(0, 7);

  await refreshAll();
})();

/* ---- tabs ---- */
document.querySelectorAll('.nav .links button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.nav .links button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
  };
});
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('[data-apanel]').forEach((p) => p.classList.toggle('hidden', p.dataset.apanel !== b.dataset.atab));
  };
});

let SITES = [];

async function refreshAll() {
  // A reporting manager gets the team screens only. Asking for the admin-only
  // endpoints would 403 and blow up the whole refresh, so skip them entirely.
  const isAdmin = ME?.role === 'admin';
  await Promise.all([
    loadDashboard(), loadLocations(), loadLeaves(), loadRegs(),
    ...(isAdmin ? [loadReport()] : []),
  ]);
  if (isAdmin) {
    await loadSites();      // populates SITES
    await loadEmployees();  // uses SITES for the pickers
  }
}

/* ---- sites (geofences) ---- */
async function loadSites() {
  const { sites } = await api('/admin/sites');
  SITES = sites;
  const body = document.getElementById('sites-body');
  if (body) {
    body.innerHTML = sites.map((s) => `<tr>
      <td><b>${esc(s.name)}</b><div class="muted small">${esc(s.address || '')}</div></td>
      <td class="num">${s.radius_m} m</td>
      <td><a href="${s.map_url}" target="_blank" rel="noopener" class="small">📍 map</a></td>
      <td class="num">${s.employees}</td>
      <td>${s.active ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Inactive</span>'}</td>
      <td><button class="btn sm ghost" data-site-toggle="${s.id}" data-val="${s.active ? 0 : 1}">${s.active ? 'Deactivate' : 'Activate'}</button>
      <button class="btn sm ghost" data-site-del="${s.id}">Delete</button></td></tr>`).join('');
    body.querySelectorAll('[data-site-toggle]').forEach((el) => (el.onclick = () => patchSite(Number(el.dataset.siteToggle), { active: el.dataset.val === '1' })));
    body.querySelectorAll('[data-site-del]').forEach((el) => (el.onclick = () => deleteSite(Number(el.dataset.siteDel))));
  }
  const opts = '<option value="field">Field (no site)</option>' + sites.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const es = document.getElementById('e-site');
  if (es) es.innerHTML = opts;
}

const siteOptions = (selected) => '<option value="field"' + (selected == null ? ' selected' : '') + '>Field (no site)</option>'
  + SITES.map((s) => `<option value="${s.id}"${selected === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');

async function patchSite(id, patch) {
  try { await api('/admin/sites/' + id, { method: 'PATCH', body: patch }); toast('Site updated'); await refreshAll(); }
  catch (err) { toast(err.message, true); }
}
async function deleteSite(id) {
  if (!window.confirm('Delete this site? Its employees become field staff.')) return;
  try { await api('/admin/sites/' + id, { method: 'DELETE' }); toast('Site deleted'); await refreshAll(); }
  catch (err) { toast(err.message, true); }
}
window.openAddSite = () => {
  openModal(`<h2>Add site</h2>
    <p class="small muted">Tip: open the showroom in Google Maps, long-press the pin and copy the coordinates.</p>
    <div class="field"><label>Name</label><input id="s-name" placeholder="Vutto Showroom — Jaipur" /></div>
    <div class="field"><label>Address</label><input id="s-addr" placeholder="Tonk Road, Jaipur" /></div>
    <div class="row2"><div class="field"><label>Latitude</label><input id="s-lat" placeholder="26.8467" /></div>
    <div class="field"><label>Longitude</label><input id="s-lng" placeholder="75.8020" /></div></div>
    <div class="field"><label>Allowed radius (metres)</label><input id="s-rad" type="number" value="250" /></div>
    <div class="foot"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" id="s-save">Create</button></div>`);
  document.getElementById('s-save').onclick = async () => {
    try {
      await api('/admin/sites', { method: 'POST', body: {
        name: document.getElementById('s-name').value.trim(),
        address: document.getElementById('s-addr').value.trim(),
        lat: document.getElementById('s-lat').value,
        lng: document.getElementById('s-lng').value,
        radius_m: document.getElementById('s-rad').value,
      } });
      toast('Site added'); closeModal(); await refreshAll();
    } catch (err) { toast(err.message, true); }
  };
};

/* ---- photo viewer ---- */
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

const photoCell = (src) => (src
  ? `<img class="punch-photo" src="${src}" alt="punch photo" onclick="viewPhoto(this.src)" />`
  : '<span class="muted small">—</span>');

const locCell = (lat, lng, address, mapUrl) => (lat != null
  ? `<a href="${mapUrl}" target="_blank" rel="noopener" class="small"><span class="pin">📍</span> ${esc(address || `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`)}</a>`
  : '<span class="muted small">—</span>');

/** Geofence verdict + fake-GPS flag for one roster row. */
const siteCell = (t) => {
  const parts = [];
  if (!t.site_name || t.site_name === 'Field') parts.push('<span class="muted small">Field (no site)</span>');
  else if (t.in_inside === 0) parts.push(`<span class="badge absent">⚠ outside ${esc(t.site_name)}</span>`);
  else if (t.in_inside === 1) parts.push(`<span class="badge present">✓ at ${esc(t.site_name)}</span>`);
  else parts.push(`<span class="muted small">${esc(t.site_name)}</span>`);
  if ((t.spoof_score || 0) >= 50) parts.push(`<span class="badge pending">⚠ GPS ${t.spoof_score}</span>`);
  return parts.join(' ');
};

/* ---- dashboard ---- */
async function loadDashboard() {
  const { stats, team, pending } = await api('/admin/dashboard');
  document.getElementById('s-total').textContent = stats.total_employees;
  document.getElementById('s-present').textContent = stats.present;
  document.getElementById('s-working').textContent = stats.working_now;
  document.getElementById('s-away').textContent = stats.absent + stats.on_leave;
  document.getElementById('s-away-sub').textContent = `${stats.absent} absent · ${stats.on_leave} on leave`;

  const total = pending.leaves + pending.regularizations;
  const dot = document.getElementById('appr-dot');
  dot.style.display = total ? 'inline-block' : 'none';
  dot.textContent = total;

  // Surface pending work on the dashboard itself, so regularizations are not
  // hidden behind the Approvals sub-tab.
  const pcard = document.getElementById('pending-card');
  if (pcard) {
    if (total) {
      pcard.classList.remove('hidden');
      pcard.innerHTML = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span class="badge pending">${total}</span>
        <b>pending approval${total > 1 ? 's' : ''}</b>
        <span class="muted small">waiting for you</span>
        <span style="flex:1"></span>
        ${pending.leaves ? `<button class="btn ghost sm" data-goto="leaves">Leave requests (${pending.leaves})</button>` : ''}
        ${pending.regularizations ? `<button class="btn primary sm" data-goto="regs">Regularizations (${pending.regularizations})</button>` : ''}
      </div>`;
      pcard.querySelectorAll('[data-goto]').forEach((el) => (el.onclick = () => gotoApprovals(el.dataset.goto)));
    } else {
      pcard.classList.add('hidden');
    }
  }

  const body = document.getElementById('team-body');
  if (!team.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No employees yet.</td></tr>'; return; }
  body.innerHTML = team.map((t) => `
    <tr>
      <td><b>${esc(t.name)}</b>${t.pending_regularizations ? ` <span class="badge pending">${t.pending_regularizations} pending</span>` : ''}<div class="muted small">${esc(t.employee_code || '')}</div></td>
      <td>${esc(t.department || '—')}</td>
      <td>${fmtTime(t.clock_in)}</td>
      <td>${fmtTime(t.clock_out)}</td>
      <td class="num">${t.worked_minutes ? fmtHours(t.worked_minutes / 60) : '—'}</td>
      <td>${photoCell(t.in_photo)}</td>
      <td>${locCell(t.in_lat, t.in_lng, t.in_address, t.in_map_url)}</td>
      <td>${siteCell(t)}</td>
      <td><span class="badge ${t.state}">${label(t.state)}</span></td>
    </tr>`).join('');
}

/* ---- live locations ---- */
async function loadLocations() {
  const data = await api('/admin/locations');
  const body = document.getElementById('loc-body');
  const note = document.getElementById('loc-note');
  if (note) note.textContent = `${data.date} · updates every ${data.ping_interval_minutes} min`;
  if (!body) return;
  if (!data.records.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No employees yet.</td></tr>'; return; }
  body.innerHTML = data.records.map((r) => `
    <tr>
      <td><b>${esc(r.name)}</b><div class="muted small">${esc(r.employee_code || '')}</div></td>
      <td>${r.on_clock ? '<span class="badge working">On clock</span>' : (r.clock_out ? '<span class="badge done">Clocked out</span>' : '<span class="badge not_in">Not in</span>')}</td>
      <td>${locCell(r.in_lat, r.in_lng, r.in_address, r.in_map_url)}</td>
      <td class="small">${r.last_seen ? fmtTime(r.last_seen) : '<span class="muted">—</span>'}</td>
      <td>${locCell(r.last_lat, r.last_lng, r.last_address, r.last_map_url)}</td>
      <td class="num">${r.ping_count}</td>
    </tr>`).join('');
}

/* Jump straight to an approvals sub-tab from the dashboard card. */
function gotoApprovals(which) {
  const tab = document.querySelector('.nav .links button[data-tab="approvals"]');
  if (tab) tab.click();
  const sub = document.querySelector(`.tabs button[data-atab="${which}"]`);
  if (sub) sub.click();
}

/* ---- leave approvals ---- */
async function loadLeaves() {
  const { records } = await api('/admin/leaves');
  const el = document.getElementById('atab-leaves');
  if (el) {
    const n = records.filter((r) => r.status === 'pending').length;
    el.innerHTML = `Leave requests ${n ? `<span class="badge pending">${n}</span>` : ''}`;
  }
  const body = document.getElementById('leaves-body');
  if (!records.length) { body.innerHTML = '<tr><td colspan="7" class="empty">No leave requests.</td></tr>'; return; }
  body.innerHTML = records.map((r) => `
    <tr>
      <td><b>${esc(r.employee_name)}</b><div class="muted small">${esc(r.department || '')}</div></td>
      <td>${label(r.type)}</td>
      <td>${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}</td>
      <td class="num">${r.days}</td>
      <td class="muted small" style="max-width:220px">${esc(r.reason || '')}</td>
      <td><span class="badge ${r.status}">${label(r.status)}</span></td>
      <td>${r.status === 'pending' ? `<button class="btn sm green" onclick="reviewLeave(${r.id},'approve')">Approve</button>
        <button class="btn sm red" style="margin-left:6px" onclick="reviewLeave(${r.id},'reject')">Reject</button>` : ''}</td>
    </tr>`).join('');
}

window.reviewLeave = async (id, action) => {
  try { await api('/admin/leaves/' + id, { method: 'PATCH', body: { action } }); toast(`Leave ${action}d`); await refreshAll(); }
  catch (err) { toast(err.message, true); }
};

/* ---- regularization approvals ---- */
async function loadRegs() {
  const { records } = await api('/admin/regularizations');
  const el = document.getElementById('atab-regs');
  if (el) {
    const n = records.filter((r) => r.status === 'pending').length;
    el.innerHTML = `Regularizations ${n ? `<span class="badge pending">${n}</span>` : ''}`;
  }
  const body = document.getElementById('regs-body');
  if (!records.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No regularization requests.</td></tr>'; return; }
  body.innerHTML = records.map((r) => `
    <tr>
      <td><b>${esc(r.employee_name)}</b><div class="muted small">${esc(r.department || '')}</div></td>
      <td>${fmtDate(r.date)}</td>
      <td class="small">${fmtTime(r.requested_clock_in)} → ${fmtTime(r.requested_clock_out)}</td>
      <td class="muted small" style="max-width:220px">${esc(r.reason || '')}</td>
      <td><span class="badge ${r.status}">${label(r.status)}</span></td>
      <td>${r.status === 'pending' ? `<button class="btn sm green" onclick="reviewReg(${r.id},'approve')">Approve</button>
        <button class="btn sm red" style="margin-left:6px" onclick="reviewReg(${r.id},'reject')">Reject</button>` : ''}</td>
    </tr>`).join('');
}

window.reviewReg = async (id, action) => {
  try { await api('/admin/regularizations/' + id, { method: 'PATCH', body: { action } }); toast(`Regularization ${action}d`); await refreshAll(); }
  catch (err) { toast(err.message, true); }
};

/* ---- employees ---- */
async function loadEmployees() {
  const { employees } = await api('/admin/employees');
  const body = document.getElementById('emp-body');
  body.innerHTML = employees.map((e) => `
    <tr>
      <td><b>${esc(e.name)}</b></td>
      <td class="muted small">${esc(e.email)}</td>
      <td class="muted small">${esc(e.employee_code || '—')}</td>
      <td>${esc(e.department || '—')}</td>
      <td><select data-mgr-set="${e.id}" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:inherit;max-width:190px">${managerOptions(e.id, e.manager_id, employees)}</select></td>
      <td>${e.role === 'admin' ? '<span class="muted small">—</span>' : `<select data-site-set="${e.id}" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:inherit;max-width:190px">${siteOptions(e.site_id)}</select>`}</td>
      <td><span class="badge ${e.role === 'admin' ? 'role-admin' : 'present'}">${label(e.role)}</span></td>
      <td class="num">${e.leave_balance}</td>
      <td><span class="badge ${e.status}">${label(e.status)}</span></td>
      <td>
        <button class="btn sm ghost" onclick="toggleRole(${e.id}, '${e.role === 'admin' ? 'user' : 'admin'}')">${e.role === 'admin' ? 'Make user' : 'Make admin'}</button>
        <button class="btn sm ghost" onclick="toggleStatus(${e.id}, '${e.status === 'active' ? 'inactive' : 'active'}')">${e.status === 'active' ? 'Deactivate' : 'Activate'}</button>
      </td>
    </tr>`).join('');
  body.querySelectorAll('[data-site-set]').forEach((el) => (el.onchange = () => patchEmployeeSite(Number(el.dataset.siteSet), el.value)));
  body.querySelectorAll('[data-mgr-set]').forEach((el) => (el.onchange = () => patchManager(Number(el.dataset.mgrSet), el.value)));
}

/* Reporting manager picker: anyone except the person themselves. */
const managerOptions = (id, selected, all) => '<option value="none"'
  + (selected == null ? ' selected' : '') + '>— nobody (reports to admin) —</option>'
  + all.filter((m) => m.id !== id)
    .map((m) => `<option value="${m.id}"${selected === m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('');

async function patchManager(id, value) {
  try {
    await api('/admin/employees/' + id, { method: 'PATCH', body: { manager_id: value === 'none' ? null : Number(value) } });
    toast('Reporting manager updated');
    await refreshAll();
  } catch (err) { toast(err.message, true); await loadEmployees(); }
}

async function patchEmployeeSite(id, value) {
  try {
    await api('/admin/employees/' + id, { method: 'PATCH', body: { site_id: value === 'field' ? null : Number(value) } });
    toast('Site updated'); await refreshAll();
  } catch (err) { toast(err.message, true); }
}

window.toggleRole = async (id, role) => {
  try { await api('/admin/employees/' + id, { method: 'PATCH', body: { role } }); toast('Role updated'); await loadEmployees(); }
  catch (err) { toast(err.message, true); }
};
window.toggleStatus = async (id, status) => {
  try { await api('/admin/employees/' + id, { method: 'PATCH', body: { status } }); toast('Status updated'); await loadEmployees(); }
  catch (err) { toast(err.message, true); }
};

/* ---- sites + payroll export wiring ---- */
document.getElementById('add-site')?.addEventListener('click', () => window.openAddSite());
document.getElementById('export-csv')?.addEventListener('click', () => {
  window.location.href = `/api/admin/payroll/export?format=csv&month=${encodeURIComponent(document.getElementById('rep-month').value || '')}`;
});
document.getElementById('export-xlsx')?.addEventListener('click', () => {
  window.location.href = `/api/admin/payroll/export?format=xlsx&month=${encodeURIComponent(document.getElementById('rep-month').value || '')}`;
});

/* ---- add employee ---- */
window.openAdd = () => document.getElementById('modal').classList.add('open');
window.closeModal = () => document.getElementById('modal').classList.remove('open');

document.getElementById('e-save').onclick = async () => {
  const body = {
    name: document.getElementById('e-name').value.trim(),
    email: document.getElementById('e-email').value.trim(),
    password: document.getElementById('e-pass').value,
    department: document.getElementById('e-dept').value.trim() || null,
    role: document.getElementById('e-role').value,
    leave_balance: Number(document.getElementById('e-bal').value) || 18,
    site_id: (function () { const v = document.getElementById('e-site').value; return v === 'field' ? null : Number(v); })(),
  };
  if (!body.name || !body.email || !body.password) return toast('Name, email and password are required', true);
  try {
    await api('/admin/employees', { method: 'POST', body });
    toast('Employee created');
    closeModal();
    ['e-name', 'e-email', 'e-pass', 'e-dept'].forEach((id) => (document.getElementById(id).value = ''));
    await loadEmployees();
  } catch (err) { toast(err.message, true); }
};

/* ---- reports ---- */
async function loadReport() {
  const month = document.getElementById('rep-month').value || new Date().toISOString().slice(0, 7);
  const { records, totals } = await api('/admin/reports/summary?month=' + month);
  const body = document.getElementById('rep-body');
  if (!records.length) { body.innerHTML = '<tr><td colspan="7" class="empty">No data.</td></tr>'; return; }
  body.innerHTML = records.map((r) => `
    <tr>
      <td><b>${esc(r.name)}</b><div class="muted small">${esc(r.employee_code || '')}</div></td>
      <td>${esc(r.department || '—')}</td>
      <td class="num">${r.present}</td>
      <td class="num">${r.half_day}</td>
      <td class="num">${r.absent}</td>
      <td class="num">${r.on_leave}</td>
      <td class="num">${r.total_hours}</td>
    </tr>`).join('') + `
    <tr style="font-weight:700;background:var(--brand-soft)">
      <td>Total</td><td></td>
      <td class="num">${totals.present}</td><td class="num">—</td>
      <td class="num">${totals.absent}</td><td class="num">—</td>
      <td class="num">${totals.total_hours}</td>
    </tr>`;
}
document.getElementById('rep-month').onchange = loadReport;

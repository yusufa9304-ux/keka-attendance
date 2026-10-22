let ME = null;
let tracker = null;
let PING_MIN = 10;

(async function init() {
  ME = await currentUser();
  if (!ME) return (location.href = '/');
  if (ME.role === 'admin') return (location.href = '/admin');

  document.getElementById('nav-avatar').textContent = initials(ME.name);
  document.getElementById('nav-name').textContent = ME.name;
  document.getElementById('nav-role').textContent = ME.is_manager
    ? (ME.department ? `${ME.department} · Manager` : 'Manager')
    : (ME.department ? `${ME.department} · Employee` : 'Employee');
  // A reporting manager gets a way through to their team.
  if (ME.can_console) document.getElementById('nav-team')?.classList.remove('hidden');
  // Who this person answers to, so the reporting line is visible to them too.
  const rt = document.getElementById('reports-to');
  if (rt) rt.textContent = ME.manager_name ? `Reporting to ${ME.manager_name}` : 'No reporting manager set';
  document.getElementById('first-name').textContent = ME.name.split(' ')[0];
  if (ME.employee_code) document.getElementById('head-sub').textContent = `${ME.employee_code} · ${ME.department || 'Employee'}`;

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('rg-date').value = today;
  document.getElementById('hist-to').value = today;
  document.getElementById('hist-from').value = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);

  startClock();
  await Promise.all([loadToday(), loadSummary(), loadBalance(), loadHistory(), loadLeaves(), loadRegs()]);
})();

/* ---- tabs ---- */
document.querySelectorAll('.nav .links button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.nav .links button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
  };
});

/* ---- live clock ---- */
function startClock() {
  const tick = () => {
    const now = new Date();
    document.getElementById('live-clock').textContent = now.toLocaleTimeString('en-IN', { hour12: false });
    document.getElementById('live-date').textContent = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  tick();
  setInterval(tick, 1000);
}

/* ---- photo viewer ---- */
window.viewPhoto = (src) => {
  let m = document.getElementById('photo-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'photo-modal';
    m.className = 'modal-bg';
    m.innerHTML = '<div class="modal photo-viewer"><h2>Punch photo</h2><img id="photo-img" alt="Punch photo" /><div class="foot"><button class="btn ghost" id="photo-close">Close</button></div></div>';
    document.body.appendChild(m);
    m.onclick = (e) => { if (e.target === m) m.classList.remove('open'); };
    m.querySelector('#photo-close').onclick = () => m.classList.remove('open');
  }
  m.querySelector('#photo-img').src = src;
  m.classList.add('open');
};

const locLine = (a, kind) => {
  const lat = kind === 'in' ? a.in_lat : a.out_lat;
  if (lat == null) return '';
  const url = kind === 'in' ? a.in_map_url : a.out_map_url;
  const addr = (kind === 'in' ? a.in_address : a.out_address) || `${Number(lat).toFixed(5)}, ${Number(kind === 'in' ? a.in_lng : a.out_lng).toFixed(5)}`;
  const photo = kind === 'in' ? a.in_photo : a.out_photo;
  const geo = kind === 'in' ? a.in_geofence : a.out_geofence;
  const spoof = kind === 'in' ? a.in_spoof : a.out_spoof;
  const geoBadge = geo
    ? (geo.inside
      ? `<span class="badge present">✓ inside ${esc(geo.site_name || 'site')} (${geo.distance_m >= 1000 ? (geo.distance_m / 1000).toFixed(1) + ' km' : geo.distance_m + ' m'})</span>`
      : `<span class="badge absent">⚠ ${geo.distance_m >= 1000 ? (geo.distance_m / 1000).toFixed(1) + ' km' : geo.distance_m + ' m'} from ${esc(geo.site_name || 'site')}</span>`)
    : '';
  const spoofBadge = spoof && spoof.suspected ? `<span class="badge pending">GPS check ${spoof.score}/100</span>` : '';
  return `<div class="photo-row" style="justify-content:center;margin-top:10px">
      ${photo ? `<img class="punch-photo" src="${photo}" alt="${kind} photo" onclick="viewPhoto(this.src)" />` : ''}
      <span class="loc"><span class="pin">${PIN_SVG}</span> <a href="${url}" target="_blank" rel="noopener">${esc(addr)}</a></span>
    </div>
    ${geoBadge || spoofBadge ? `<div style="margin-top:6px">${geoBadge} ${spoofBadge}</div>` : ''}`;
};

const PIN_SVG = '<svg class="pin-ico" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>';

/* ---- today ---- */
async function loadToday() {
  const { attendance, pings, ping_interval_minutes, site: attendanceSite } = await api('/attendance/today');
  PING_MIN = ping_interval_minutes || 10;
  const inEl = document.getElementById('today-in');
  const outEl = document.getElementById('today-out');
  const workedEl = document.getElementById('today-worked');
  const statusEl = document.getElementById('today-status');
  const btnIn = document.getElementById('btn-in');
  const btnOut = document.getElementById('btn-out');
  const locEl = document.getElementById('today-loc');
  const noteEl = document.getElementById('track-note');

  if (!attendance) {
    inEl.textContent = outEl.textContent = workedEl.textContent = '—';
    statusEl.innerHTML = '<span class="badge not_in">Not marked</span>';
    locEl.innerHTML = attendanceSite
      ? `<div class="track-note" style="margin-top:14px">You are checked against <b>${esc(attendanceSite.name)}</b> — punch within ${attendanceSite.radius_m} m.</div>`
      : '';
    btnIn.disabled = false; btnOut.disabled = true;
    noteEl.textContent = 'Location and a selfie are required for every punch.';
    stopTracking();
    return;
  }
  inEl.textContent = fmtTime(attendance.clock_in);
  outEl.textContent = fmtTime(attendance.clock_out);
  workedEl.textContent = attendance.worked_minutes ? fmtHours(attendance.worked_minutes / 60) : '—';
  statusEl.innerHTML = `<span class="badge ${attendance.status}">${label(attendance.status)}</span>`;
  btnIn.disabled = !!attendance.clock_in;
  btnOut.disabled = !attendance.clock_in || !!attendance.clock_out;

  locEl.innerHTML = locLine(attendance, 'in') + (attendance.clock_out ? locLine(attendance, 'out') : '');
  if (!attendance.clock_in && attendanceSite) {
    locEl.innerHTML += `<div class="track-note" style="margin-top:14px">You are checked against <b>${esc(attendanceSite.name)}</b> — punch within ${attendanceSite.radius_m} m.</div>`;
  }

  const onClock = !!attendance.clock_in && !attendance.clock_out;
  if (onClock) {
    noteEl.textContent = `On the clock — location updates every ${PING_MIN} min (${pings} update${pings === 1 ? '' : 's'} so far today).`;
    startTracking();
  } else {
    noteEl.textContent = `Tracking stopped. ${pings} location update${pings === 1 ? '' : 's'} recorded today.`;
    stopTracking();
  }
}

/* ---- punch in / out: location + selfie required ---- */
async function punch(kind) {
  const btnIn = document.getElementById('btn-in');
  const btnOut = document.getElementById('btn-out');
  btnIn.disabled = btnOut.disabled = true;
  try {
    const proof = await CAPTURE.punchProof((msg) => toast(msg));
    const path = kind === 'in' ? '/attendance/clock-in' : '/attendance/clock-out';
    await api(path, { method: 'POST', body: proof });
    toast(kind === 'in' ? 'Clocked in — photo + location saved' : 'Clocked out — photo + location saved');
    await Promise.all([loadToday(), loadSummary(), loadHistory()]);
  } catch (err) {
    toast(err.message, true);
    await loadToday();
  }
}
document.getElementById('btn-in').onclick = () => punch('in');
document.getElementById('btn-out').onclick = () => punch('out');

/* ---- periodic location tracking ---- */
function startTracking() {
  if (tracker) return;
  tracker = CAPTURE.startTracking(PING_MIN, async (pos) => {
    try { await api('/attendance/ping', { method: 'POST', body: pos }); } catch { /* best effort */ }
  });
}
function stopTracking() { if (tracker) { tracker.stop(); tracker = null; } }

/* ---- month summary ---- */
async function loadSummary() {
  const s = await api('/attendance/summary');
  document.getElementById('m-present').textContent = s.present;
  document.getElementById('m-half').textContent = s.half_day;
  document.getElementById('m-absent').textContent = s.absent;
  document.getElementById('m-hours').textContent = s.total_hours;
}

/* ---- leave balance ---- */
async function loadBalance() {
  const b = await api('/leave/balance');
  document.getElementById('leave-bal').textContent = b.remaining;
  document.getElementById('leave-sub').textContent = `${b.used} used of ${b.entitlement} this year`;
  document.getElementById('lv-hint').textContent = `You have ${b.remaining} days of paid leave remaining.`;
}

/* Geofence + GPS verdict for a history row. */
const histSiteCell = (r) => {
  const parts = [];
  if (r.in_geofence) {
    const g = r.in_geofence;
    const d = g.distance_m >= 1000 ? `${(g.distance_m / 1000).toFixed(1)} km` : `${g.distance_m} m`;
    parts.push(g.inside
      ? `<span class="badge present">✓ at ${esc(g.site_name || 'site')} (${d})</span>`
      : `<span class="badge absent">⚠ ${d} from ${esc(g.site_name || 'site')}</span>`);
  } else {
    parts.push('<span class="muted small">—</span>');
  }
  if (r.in_spoof?.suspected) parts.push(`<span class="badge pending">⚠ GPS ${r.in_spoof.score}</span>`);
  return parts.join(' ');
};

/* ---- history ---- */
async function loadHistory() {
  const from = document.getElementById('hist-from').value;
  const to = document.getElementById('hist-to').value;
  const { records } = await api(`/attendance/history?from=${from}&to=${to}`);
  const body = document.getElementById('hist-body');
  if (!records.length) { body.innerHTML = '<tr><td colspan="7" class="empty">No records in this range.</td></tr>'; return; }
  body.innerHTML = records.map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${fmtTime(r.clock_in)}${r.is_late ? ' <span class="badge half_day" style="font-size:.7rem">late</span>' : ''}</td>
      <td>${fmtTime(r.clock_out)}</td>
      <td class="num">${r.worked_minutes ? fmtHours(r.worked_minutes / 60) : '—'}</td>
      <td>${r.in_photo ? `<img class="punch-photo" src="${r.in_photo}" alt="in" onclick="viewPhoto(this.src)" />` : '<span class="muted small">—</span>'}</td>        <td class="small">${r.in_map_url ? `<a href="${r.in_map_url}" target="_blank" rel="noopener"><span class="pin">${PIN_SVG}</span> ${esc(r.in_address || 'View map')}</a>` : '<span class="muted">—</span>'}</td>
        <td>${histSiteCell(r)}</td>
        <td><span class="badge ${r.status}">${label(r.status)}</span></td>
    </tr>`).join('');
}
document.getElementById('hist-go').onclick = loadHistory;

/* ---- leaves ---- */
async function loadLeaves() {
  const { types } = await api('/leave/types');
  document.getElementById('lv-type').innerHTML = types.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');

  const { records } = await api('/leave/mine');
  const body = document.getElementById('leave-body');
  if (!records.length) { body.innerHTML = '<tr><td colspan="5" class="empty">No leave requests yet.</td></tr>'; return; }
  body.innerHTML = records.map((r) => `
    <tr>
      <td>${label(r.type)}</td>
      <td>${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}</td>
      <td class="num">${r.days}</td>
      <td><span class="badge ${r.status}">${label(r.status)}</span></td>
      <td>${r.status === 'pending' ? `<button class="btn sm ghost" onclick="cancelLeave(${r.id})">Cancel</button>` : ''}</td>
    </tr>`).join('');
}

window.cancelLeave = async (id) => {
  try { await api('/leave/' + id, { method: 'DELETE' }); toast('Request cancelled'); await Promise.all([loadLeaves(), loadBalance()]); }
  catch (err) { toast(err.message, true); }
};

document.getElementById('lv-submit').onclick = async () => {
  const body = {
    type: document.getElementById('lv-type').value,
    start_date: document.getElementById('lv-start').value,
    end_date: document.getElementById('lv-end').value,
    reason: document.getElementById('lv-reason').value,
  };
  if (!body.start_date || !body.end_date) return toast('Please pick both dates', true);
  try {
    const r = await api('/leave', { method: 'POST', body });
    toast(`Leave request submitted (${r.days} day${r.days > 1 ? 's' : ''})`);
    document.getElementById('lv-reason').value = '';
    await Promise.all([loadLeaves(), loadBalance()]);
  } catch (err) { toast(err.message, true); }
};

/* ---- regularizations ---- */
async function loadRegs() {
  const { records } = await api('/attendance/regularizations');
  const body = document.getElementById('reg-body');
  if (!records.length) { body.innerHTML = '<tr><td colspan="3" class="empty">No regularization requests.</td></tr>'; return; }
  body.innerHTML = records.map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td class="small">${fmtTime(r.requested_clock_in)} → ${fmtTime(r.requested_clock_out)}</td>
      <td><span class="badge ${r.status}">${label(r.status)}</span></td>
    </tr>`).join('');
}

document.getElementById('rg-submit').onclick = async () => {
  const date = document.getElementById('rg-date').value;
  const inT = document.getElementById('rg-in').value;
  const outT = document.getElementById('rg-out').value;
  const reason = document.getElementById('rg-reason').value;
  if (!date || !reason) return toast('Date and reason are required', true);
  try {
    await api('/attendance/regularize', {
      method: 'POST',
      body: {
        date,
        requested_clock_in: inT ? `${date}T${inT}:00` : null,
        requested_clock_out: outT ? `${date}T${outT}:00` : null,
        reason,
      },
    });
    toast('Regularization request submitted');
    document.getElementById('rg-reason').value = '';
    await loadRegs();
  } catch (err) { toast(err.message, true); }
};

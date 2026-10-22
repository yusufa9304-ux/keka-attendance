let ME = null;

(async function init() {
  ME = await currentUser();
  if (!ME) return (location.href = '/');
  if (ME.role === 'admin') return (location.href = '/admin');

  document.getElementById('nav-avatar').textContent = initials(ME.name);
  document.getElementById('nav-name').textContent = ME.name;
  document.getElementById('nav-role').textContent = ME.department ? `${ME.department} · Employee` : 'Employee';
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

/* ---- today ---- */
async function loadToday() {
  const { attendance } = await api('/attendance/today');
  const inEl = document.getElementById('today-in');
  const outEl = document.getElementById('today-out');
  const workedEl = document.getElementById('today-worked');
  const statusEl = document.getElementById('today-status');
  const btnIn = document.getElementById('btn-in');
  const btnOut = document.getElementById('btn-out');

  if (!attendance) {
    inEl.textContent = outEl.textContent = workedEl.textContent = '—';
    statusEl.innerHTML = '<span class="badge not_in">Not marked</span>';
    btnIn.disabled = false; btnOut.disabled = true;
    return;
  }
  inEl.textContent = fmtTime(attendance.clock_in);
  outEl.textContent = fmtTime(attendance.clock_out);
  workedEl.textContent = attendance.worked_minutes ? fmtHours(attendance.worked_minutes / 60) : '—';
  statusEl.innerHTML = `<span class="badge ${attendance.status}">${label(attendance.status)}</span>`;
  btnIn.disabled = !!attendance.clock_in;
  btnOut.disabled = !attendance.clock_in || !!attendance.clock_out;
}

document.getElementById('btn-in').onclick = async (e) => {
  e.target.disabled = true;
  try { await api('/attendance/clock-in', { method: 'POST' }); toast('Clocked in. Have a good day!'); await Promise.all([loadToday(), loadSummary(), loadHistory()]); }
  catch (err) { toast(err.message, true); await loadToday(); }
};
document.getElementById('btn-out').onclick = async (e) => {
  e.target.disabled = true;
  try { await api('/attendance/clock-out', { method: 'POST' }); toast('Clocked out. See you tomorrow!'); await Promise.all([loadToday(), loadSummary(), loadHistory()]); }
  catch (err) { toast(err.message, true); await loadToday(); }
};

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

/* ---- history ---- */
async function loadHistory() {
  const from = document.getElementById('hist-from').value;
  const to = document.getElementById('hist-to').value;
  const { records } = await api(`/attendance/history?from=${from}&to=${to}`);
  const body = document.getElementById('hist-body');
  if (!records.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No records in this range.</td></tr>'; return; }
  body.innerHTML = records.map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${fmtTime(r.clock_in)}${r.is_late ? ' <span class="badge half_day" style="font-size:.7rem">late</span>' : ''}</td>
      <td>${fmtTime(r.clock_out)}</td>
      <td class="num">${r.worked_minutes ? fmtHours(r.worked_minutes / 60) : '—'}</td>
      <td><span class="badge ${r.status}">${label(r.status)}</span></td>
      <td class="muted small">${esc(r.note || '')}</td>
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

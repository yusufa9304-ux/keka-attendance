let ME = null;

(async function init() {
  ME = await currentUser();
  if (!ME) return (location.href = '/');
  if (ME.role !== 'admin') return (location.href = '/dashboard');

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

async function refreshAll() {
  await Promise.all([loadDashboard(), loadLeaves(), loadRegs(), loadEmployees(), loadReport()]);
}

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

  const body = document.getElementById('team-body');
  if (!team.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No employees yet.</td></tr>'; return; }
  body.innerHTML = team.map((t) => `
    <tr>
      <td><b>${esc(t.name)}</b><div class="muted small">${esc(t.employee_code || '')}</div></td>
      <td>${esc(t.department || '—')}</td>
      <td>${fmtTime(t.clock_in)}</td>
      <td>${fmtTime(t.clock_out)}</td>
      <td class="num">${t.worked_minutes ? fmtHours(t.worked_minutes / 60) : '—'}</td>
      <td><span class="badge ${t.state}">${label(t.state)}</span></td>
    </tr>`).join('');
}

/* ---- leave approvals ---- */
async function loadLeaves() {
  const { records } = await api('/admin/leaves');
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
      <td><span class="badge ${e.role === 'admin' ? 'role-admin' : 'present'}">${label(e.role)}</span></td>
      <td class="num">${e.leave_balance}</td>
      <td><span class="badge ${e.status}">${label(e.status)}</span></td>
      <td>
        <button class="btn sm ghost" onclick="toggleRole(${e.id}, '${e.role === 'admin' ? 'user' : 'admin'}')">${e.role === 'admin' ? 'Make user' : 'Make admin'}</button>
        <button class="btn sm ghost" onclick="toggleStatus(${e.id}, '${e.status === 'active' ? 'inactive' : 'active'}')">${e.status === 'active' ? 'Deactivate' : 'Activate'}</button>
      </td>
    </tr>`).join('');
}

window.toggleRole = async (id, role) => {
  try { await api('/admin/employees/' + id, { method: 'PATCH', body: { role } }); toast('Role updated'); await loadEmployees(); }
  catch (err) { toast(err.message, true); }
};
window.toggleStatus = async (id, status) => {
  try { await api('/admin/employees/' + id, { method: 'PATCH', body: { status } }); toast('Status updated'); await loadEmployees(); }
  catch (err) { toast(err.message, true); }
};

/* ---- add employee ---- */
window.openAdd = () => document.getElementById('modal').classList.add('open');
window.closeModal = () => document.getElementById('modal').classList.remove('open');

document.getElementById('e-save').onclick = async () => {
  const body = {
    name: document.getElementById('e-name').value.trim(),
    email: document.getElementById('e-email').value.trim(),
    password: document.getElementById('e-pass').value,
    employee_code: document.getElementById('e-code').value.trim() || null,
    department: document.getElementById('e-dept').value.trim() || null,
    role: document.getElementById('e-role').value,
    leave_balance: Number(document.getElementById('e-bal').value) || 18,
  };
  if (!body.name || !body.email || !body.password) return toast('Name, email and password are required', true);
  try {
    await api('/admin/employees', { method: 'POST', body });
    toast('Employee created');
    closeModal();
    ['e-name', 'e-email', 'e-pass', 'e-code', 'e-dept'].forEach((id) => (document.getElementById(id).value = ''));
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

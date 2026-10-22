import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 3999;
const HOST = '127.0.0.1';

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout')), 15000);
    child.stdout.on('data', (d) => {
      if (d.toString().includes('running on')) { clearTimeout(t); resolve(); }
    });
    child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  });
}

function makeClient() {
  let cookie = '';
  /** Raw GET (no JSON parsing) — for CSV / XLSX downloads. */
  const rawGet = (path) => new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path, method: 'GET', headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'] || '',
          body: buf.toString('utf8'),
          b64: buf.toString('base64'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });

  const client = (path, opts = {}) => new Promise((resolve, reject) => {
    const payload = opts.body ? JSON.stringify(opts.body) : null;
    const req = http.request({
      host: HOST, port: PORT, path, method: opts.method || 'GET',
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      const sc = res.headers['set-cookie'];
      if (sc && sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let data;
        try { data = JSON.parse(body); } catch { data = body.slice(0, 100); }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
  client.raw = rawGet;
  return client;
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });

try {
  await waitForServer(server);

  const anon = makeClient();
  const admin = makeClient();
  const user = makeClient();
  const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const PROOF = { lat: 28.6139, lng: 77.209, accuracy: 12, address: 'Connaught Place, New Delhi', photo: PHOTO };

  console.log('\n[health]');
  let r = await anon('/api/health');
  check('health 200', r.status === 200 && r.data.ok);

  console.log('\n[auth]');
  r = await admin('/api/auth/login', { method: 'POST', body: { email: 'admin@vutto.demo', password: 'Admin@123' } });
  check('admin login', r.status === 200 && r.data.user.role === 'admin', JSON.stringify(r.data));
  r = await anon('/api/auth/login', { method: 'POST', body: { email: 'admin@vutto.demo', password: 'wrong' } });
  check('bad password rejected', r.status === 401);

  console.log('\n[admin dashboard]');
  r = await admin('/api/admin/dashboard');
  check('dashboard 200', r.status === 200 && r.data.stats.total_employees >= 4, JSON.stringify(r.data?.stats));
  check('roster present', Array.isArray(r.data.team) && r.data.team.length >= 4);
  console.log('    stats:', JSON.stringify(r.data.stats), 'pending:', JSON.stringify(r.data.pending));

  console.log('\n[admin employee management]');
  r = await admin('/api/admin/employees', { method: 'POST', body: { name: 'Test Emp', email: 'test@vutto.demo', password: 'Test@123', role: 'user', department: 'QA', employee_code: 'KKA-0099' } });
  check('create employee 201', r.status === 201 && r.data.employee.id, JSON.stringify(r.data));
  const newId = r.data.employee?.id;
  r = await admin('/api/admin/employees/' + newId, { method: 'PATCH', body: { role: 'admin' } });
  check('promote to admin', r.status === 200 && r.data.employee.role === 'admin');
  r = await admin('/api/admin/employees/' + newId, { method: 'PATCH', body: { status: 'inactive' } });
  check('deactivate', r.status === 200 && r.data.employee.status === 'inactive');

  r = await admin('/api/admin/employees', { method: 'POST', body: { name: 'Auto Code', email: 'auto@vutto.demo', password: 'Test@123' } });
  check('employee id auto-generated', r.status === 201 && /^VUT-\d{4}$/.test(r.data.employee?.employee_code || ''), JSON.stringify(r.data.employee));

  const meId = (await admin('/api/auth/me')).data.user.id;
  r = await admin('/api/admin/employees/' + meId, { method: 'PATCH', body: { role: 'user' } });
  check('admin cannot demote themselves', r.status === 400, 'got ' + r.status);
  r = await admin('/api/admin/employees/' + meId, { method: 'PATCH', body: { status: 'inactive' } });
  check('admin cannot deactivate themselves', r.status === 400, 'got ' + r.status);
  r = await admin('/api/auth/me');
  check('admin still an active admin', r.data.user.role === 'admin' && r.data.user.status === 'active');

  console.log('\n[admin approvals]');
  r = await admin('/api/admin/leaves?status=pending');
  const pendingLeave = r.data.records?.[0];
  check('pending leaves listed', r.status === 200 && !!pendingLeave, JSON.stringify(r.data).slice(0, 120));
  if (pendingLeave) {
    r = await admin('/api/admin/leaves/' + pendingLeave.id, { method: 'PATCH', body: { action: 'approve' } });
    check('approve leave', r.status === 200 && r.data.status === 'approved');
    r = await admin('/api/admin/leaves/' + pendingLeave.id, { method: 'PATCH', body: { action: 'approve' } });
    check('re-review blocked', r.status === 409);
  }
  r = await admin('/api/admin/regularizations?status=pending');
  const reg = r.data.records?.[0];
  check('pending regularization listed', r.status === 200 && !!reg);
  if (reg) {
    r = await admin('/api/admin/regularizations/' + reg.id, { method: 'PATCH', body: { action: 'approve' } });
    check('approve regularization', r.status === 200 && r.data.status === 'approved');
  }
  r = await admin('/api/admin/reports/summary');
  check('report 200', r.status === 200 && Array.isArray(r.data.records), JSON.stringify(r.data).slice(0, 120));

  console.log('\n[admin locations]');
  r = await admin('/api/admin/locations');
  check('locations 200', r.status === 200 && Array.isArray(r.data.records), JSON.stringify(r.data).slice(0, 120));
  check('locations expose punch address', r.data.records.some((x) => x.in_address || x.last_address));
  check('locations expose map links', r.data.records.some((x) => x.in_map_url || x.last_map_url));
  const withTrail = r.data.records.find((x) => x.ping_count > 0);
  if (withTrail) {
    const t = await admin(`/api/admin/locations/${withTrail.user_id}/trail`);
    check('trail endpoint returns pings', t.status === 200 && t.data.pings.length > 0, 'n=' + t.data.pings?.length);
  }
  r = await admin('/api/admin/dashboard');
  check('dashboard carries punch location', r.data.team.some((t) => t.in_map_url));

  console.log('\n[user login + punch]');
  r = await user('/api/auth/login', { method: 'POST', body: { email: 'aarav@vutto.demo', password: 'User@123' } });
  check('user login', r.status === 200 && r.data.user.role === 'user');
  r = await user('/api/admin/dashboard');
  check('user blocked from admin', r.status === 403, 'got ' + r.status);
  r = await user('/api/attendance/today');
  check('today 200', r.status === 200);

  // Location + selfie are mandatory on every punch.
  r = await user('/api/attendance/clock-in', { method: 'POST', body: {} });
  check('clock in blocked without location/photo', r.status === 400, 'got ' + r.status);
  r = await user('/api/attendance/clock-in', { method: 'POST', body: { lat: 28.6, lng: 77.2 } });
  check('clock in blocked without photo', r.status === 400, 'got ' + r.status);
  r = await user('/api/attendance/clock-in', { method: 'POST', body: { photo: PHOTO } });
  check('clock in blocked without location', r.status === 400, 'got ' + r.status);

  r = await user('/api/attendance/clock-in', { method: 'POST', body: PROOF });
  check('clock in ok with location + photo', r.status === 200 && r.data.attendance.clock_in && r.data.attendance.in_lat, JSON.stringify(r.data).slice(0, 160));
  check('clock-in photo stored', typeof r.data.attendance?.in_photo === 'string' && r.data.attendance.in_photo.startsWith('data:image/'));
  check('clock-in address stored', r.data.attendance?.in_address === PROOF.address);
  check('clock-in map url built', typeof r.data.attendance?.in_map_url === 'string' && r.data.attendance.in_map_url.includes('maps'));
  check('geofence evaluated — punch inside the showroom', r.data.geofence?.inside === true, JSON.stringify(r.data.geofence));
  check('clean punch is not flagged as fake GPS', r.data.spoof?.suspected === false, JSON.stringify(r.data.spoof));

  r = await user('/api/attendance/clock-in', { method: 'POST', body: PROOF });
  check('double clock-in blocked', r.status === 409);

  r = await user('/api/attendance/ping', { method: 'POST', body: { lat: 28.61, lng: 77.21, accuracy: 20, address: 'Connaught Place, New Delhi' } });
  check('10-min location ping accepted', r.status === 200 && r.data.ok);
  r = await user('/api/attendance/ping', { method: 'POST', body: {} });
  check('ping without coords rejected', r.status === 400);

  r = await user('/api/attendance/clock-out', { method: 'POST', body: { ...PROOF, lat: 28.62, lng: 77.22 } });
  check('clock out ok with location + photo', r.status === 200 && r.data.attendance.clock_out && r.data.attendance.out_lat, JSON.stringify(r.data).slice(0, 160));
  r = await user('/api/attendance/clock-out', { method: 'POST', body: PROOF });
  check('double clock-out blocked', r.status === 409);

  r = await user('/api/attendance/trail');
  check('own location trail recorded', r.status === 200 && r.data.pings.length >= 3, 'n=' + r.data.pings?.length);
  r = await user('/api/attendance/history');
  check('history rows', r.status === 200 && r.data.records.length > 0, 'rows=' + r.data.records?.length);
  r = await user('/api/attendance/summary');
  check('summary 200', r.status === 200 && typeof r.data.present === 'number');

  console.log('\n[user leave]');
  r = await user('/api/leave/balance');
  check('balance 200', r.status === 200 && typeof r.data.remaining === 'number', JSON.stringify(r.data));
  r = await user('/api/leave', { method: 'POST', body: { type: 'casual', start_date: '2026-11-10', end_date: '2026-11-12', reason: 'Trip' } });
  check('apply leave 201', r.status === 201 && r.data.days === 3, JSON.stringify(r.data));
  r = await user('/api/leave/mine');
  check('my leaves listed', r.status === 200 && r.data.records.length > 0);

  console.log('\n[user regularization]');
  r = await user('/api/attendance/regularize', { method: 'POST', body: { date: '2026-11-05', requested_clock_in: '2026-11-05T09:40:00', requested_clock_out: '2026-11-05T18:45:00', reason: 'Missed punch' } });
  check('regularize 201', r.status === 201, JSON.stringify(r.data));

  console.log('\n[geofence + fake-GPS signals]');
  // A brand-new employee assigned to a known showroom, so they have no punch today.
  r = await admin('/api/admin/employees', { method: 'POST', body: { name: 'Geo Tester', email: 'geo@vutto.demo', password: 'Geo@123', department: 'Sales' } });
  const geoId = r.data.employee.id;
  const cpSite = (await admin('/api/admin/sites')).data.sites.find((s) => /Connaught/.test(s.name));
  await admin('/api/admin/employees/' + geoId, { method: 'PATCH', body: { site_id: cpSite.id } });

  const priya = makeClient();
  await priya('/api/auth/login', { method: 'POST', body: { email: 'geo@vutto.demo', password: 'Geo@123' } });
  r = await priya('/api/attendance/clock-in', {
    method: 'POST',
    body: { lat: 28.70, lng: 77.30, accuracy: 0, address: 'Somewhere else entirely', photo: PHOTO, ts: Date.now() - 3600_000 },
  });
  check('geofenced employee has a site on /today', (await priya('/api/attendance/today')).data.site?.name?.includes('Connaught'));
  check('punch far from the assigned site is flagged outside', r.status === 200 && r.data.geofence?.inside === false, JSON.stringify(r.data.geofence));
  check('mock-location fingerprint is scored', r.data.spoof?.suspected === true, JSON.stringify(r.data.spoof));
  check('spoof reasons are recorded', Array.isArray(r.data.spoof?.flags) && r.data.spoof.flags.length >= 2, JSON.stringify(r.data.spoof?.flags));
  check('outside-geofence distance returned', r.data.geofence?.distance_m > 1000, String(r.data.geofence?.distance_m));
  r = await priya('/api/attendance/ping', { method: 'POST', body: { lat: 28.70, lng: 77.30, accuracy: 0 } });
  check('ping also carries the geofence + spoof verdict', r.status === 200 && r.data.geofence && typeof r.data.spoof?.score === 'number');

  console.log('\n[admin: sites]');
  r = await admin('/api/admin/sites');
  check('sites listed', r.status === 200 && r.data.sites.length >= 5, 'n=' + r.data.sites?.length);
  check('sites expose a map link + employee count', r.data.sites.every((s) => s.map_url && typeof s.employees === 'number'));
  r = await admin('/api/admin/sites', { method: 'POST', body: { name: 'Vutto Showroom — Test', address: 'Test Chowk', lat: 28.61, lng: 77.21, radius_m: 150 } });
  check('site created', r.status === 201 && r.data.site.radius_m === 150, JSON.stringify(r.data).slice(0, 120));
  const newSite = r.data.site.id;
  r = await admin('/api/admin/sites/' + newSite, { method: 'PATCH', body: { radius_m: 500 } });
  check('site radius updated', r.status === 200 && r.data.site.radius_m === 500);
  r = await admin('/api/admin/sites', { method: 'POST', body: { name: 'Bad site' } });
  check('site without coordinates rejected', r.status === 400);
  r = await admin('/api/admin/employees/' + newId, { method: 'PATCH', body: { site_id: newSite } });
  check('employee assigned to a site', r.status === 200 && r.data.employee.site_id === newSite, JSON.stringify(r.data.employee));
  r = await admin('/api/admin/employees/' + newId, { method: 'PATCH', body: { site_id: 'field' } });
  check('employee set back to field staff', r.status === 200 && r.data.employee.site_id === null);
  r = await admin('/api/admin/sites/' + newSite, { method: 'DELETE' });
  check('site deleted', r.status === 200);

  console.log('\n[admin: payroll export]');
  r = await admin('/api/admin/payroll');
  check('payroll json 200', r.status === 200 && Array.isArray(r.data.records) && r.data.columns.length >= 12, 'cols=' + r.data.columns?.length);
  const pr = r.data.records.find((x) => x.employee_code === 'VUT-0002');
  check('payroll has payable days + hours', pr && typeof pr.payable_days === 'number' && typeof pr.worked_hours === 'number', JSON.stringify(pr));
  check('payroll counts outside-geofence punches', typeof pr?.outside_geofence === 'number');
  r = await admin.raw('/api/admin/payroll/export?format=csv');
  check('payroll csv served', r.status === 200 && /text\/csv/.test(r.contentType || '') && /Employee Code/.test(r.body || ''), r.contentType);
  check('csv has a row per employee', (r.body || '').split('\r\n').filter(Boolean).length >= 5);
  r = await admin.raw('/api/admin/payroll/export?format=xlsx');
  check('payroll xlsx served', r.status === 200 && /spreadsheetml/.test(r.contentType || ''), r.contentType);
  check('xlsx looks like a zip (PK header)', (r.b64 || '').slice(0, 4) === 'UEsD', (r.b64 || '').slice(0, 8));

  console.log('\n[logout]');
  r = await user('/api/auth/logout', { method: 'POST' });
  check('logout ok', r.status === 200);
  r = await user('/api/attendance/today');
  check('after logout blocked', r.status === 401);

} catch (e) {
  console.error('TEST HARNESS ERROR:', e.message);
  fail++;
} finally {
  server.kill('SIGKILL');
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);

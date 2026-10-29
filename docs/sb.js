/* The data layer.
 *
 * Everything the screens read is pulled into memory once and kept in the same
 * shapes the interface already used, so the screens themselves did not have to
 * be rewritten around async calls. A write goes to the database first, and only
 * if it succeeds do we update the copy in memory and redraw.
 *
 * Who may see what is not decided here. It is decided by row level security in
 * the database, so even if this file were rewritten by hand in the browser, the
 * database would still refuse to hand over another team's records.
 */
(function () {
  const { supabaseUrl, supabaseKey } = window.VUTTO;
  const client = window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const monthStart = () => todayStr().slice(0, 7) + '-01';
  const fail = (error) => { throw new Error(error.message || String(error)); };

  const SB = {
    client,
    todayStr,
    monthStart,

    /* ---------------- signing in ---------------- */
    async session() {
      const { data } = await client.auth.getSession();
      return data.session || null;
    },
    onAuthChange(fn) {
      client.auth.onAuthStateChange((_event, session) => fn(session));
    },
    async signInWithGoogle() {
      const back = location.origin + location.pathname;
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: back, queryParams: { prompt: 'select_account' } },
      });
      if (error) fail(error);
    },
    async signOut() {
      await client.auth.signOut();
    },

    /* ---------------- who am I ----------------
     * An admin may add someone after that person first signed in, so we ask the
     * database to attach the row to this account before looking it up.
     */
    async me() {
      const { data: { user } } = await client.auth.getUser();
      if (!user) return null;
      try { await client.rpc('claim_profile'); } catch (_) { /* not fatal */ }
      const { data, error } = await client.from('employees').select('*').eq('auth_id', user.id).maybeSingle();
      if (error) fail(error);
      return data || null;
    },

    /* ---------------- reading ---------------- */
    async loadAll() {
      const [sites, people, attendance, leaves, regs, pings] = await Promise.all([
        client.from('sites').select('*').order('name'),
        client.from('employees').select('*').order('employee_code'),
        client.from('attendance').select('*').gte('work_date', monthStart()).order('work_date', { ascending: false }),
        client.from('leaves').select('*').order('created_at', { ascending: false }),
        client.from('regularizations').select('*').order('created_at', { ascending: false }),
        client.from('location_pings').select('*').eq('work_date', todayStr()).order('at'),
      ]);
      for (const r of [sites, people, attendance, leaves, regs, pings]) if (r.error) fail(r.error);

      // keep the names the screens already use
      const db = window.DB;
      if (!db) throw new Error('The app did not finish starting up.');
      db.sites = sites.data || [];
      db.users = people.data || [];
      db.attendance = attendance.data || [];
      db.leaves = leaves.data || [];
      db.regularizations = regs.data || [];
      db.location_pings = pings.data || [];
      return db;
    },

    /* ---------------- writing ----------------
     * Each of these returns the row the database actually stored, so the screen
     * can trust it rather than guessing.
     */
    async punch({ userId, kind, lat, lng, address, siteId, inside, photoRef, photoStore, spoof, workedMinutes, status }) {
      const date = todayStr();
      const { data: existing } = await client.from('attendance').select('id')
        .eq('user_id', userId).eq('work_date', date).maybeSingle();

      const stamp = new Date().toISOString();
      const row = kind === 'in'
        ? { user_id: userId, work_date: date, clock_in: stamp, status: 'present',
            in_lat: lat, in_lng: lng, in_address: address, in_site_id: siteId, in_inside: inside,
            in_photo_ref: photoRef, in_photo_store: photoStore,
            spoof_score: spoof ? spoof.score : null, spoof_reasons: spoof ? spoof.reasons : null }
        : { user_id: userId, work_date: date, clock_out: stamp,
            worked_minutes: workedMinutes ?? null, status: status || 'present',
            out_lat: lat, out_lng: lng, out_address: address, out_site_id: siteId, out_inside: inside,
            out_photo_ref: photoRef, out_photo_store: photoStore };

      const q = existing && existing.id
        ? client.from('attendance').update(row).eq('id', existing.id).select().single()
        : client.from('attendance').insert(row).select().single();
      const { data, error } = await q;
      if (error) fail(error);
      return data;
    },

    async ping(userId, lat, lng, accuracy) {
      const { error } = await client.from('location_pings')
        .insert({ user_id: userId, work_date: todayStr(), lat, lng, accuracy });
      if (error) fail(error);
    },

    async applyLeave(userId, kind, start, end, reason) {
      const { data, error } = await client.from('leaves')
        .insert({ user_id: userId, kind, start_date: start, end_date: end, reason })
        .select().single();
      if (error) fail(error);
      return data;
    },

    async raiseRegularization(userId, date, inTime, outTime, reason) {
      const { data, error } = await client.from('regularizations')
        .insert({ user_id: userId, work_date: date, in_time: inTime, out_time: outTime, reason })
        .select().single();
      if (error) fail(error);
      return data;
    },

    /* Approving a leave also moves the balance and writes the affected days, so
       the database does the whole thing rather than the browser making several
       calls that could half-apply. */
    async cancelLeave(id) {
      const { error } = await client.from('leaves').delete().eq('id', id);
      if (error) fail(error);
    },

    async decideLeave(id, status) {
      const { data, error } = await client.rpc('decide_leave', { p_id: id, p_status: status });
      if (error) fail(error);
      return data;
    },
    async decideRegularization(id, status) {
      const { data, error } = await client.rpc('decide_regularization', { p_id: id, p_status: status });
      if (error) fail(error);
      return data;
    },

    async saveEmployee(row, id) {
      const q = id
        ? client.from('employees').update(row).eq('id', id).select().single()
        : client.from('employees').insert(row).select().single();
      const { data, error } = await q;
      if (error) fail(error);
      return data;
    },

    async saveSite(row, id) {
      const q = id
        ? client.from('sites').update(row).eq('id', id).select().single()
        : client.from('sites').insert(row).select().single();
      const { data, error } = await q;
      if (error) fail(error);
      return data;
    },

    async deleteSite(id) {
      const { error: e1 } = await client.from('employees').update({ site_id: null }).eq('site_id', id);
      if (e1) fail(e1);
      const { error: e2 } = await client.from('sites').delete().eq('id', id);
      if (e2) fail(e2);
    },

    async setSetting(key, value) {
      const { error } = await client.from('settings').upsert({ key, value });
      if (error) fail(error);
    },
  };

  window.SB = SB;
})();

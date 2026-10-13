'use strict';
/* =====================================================================
   Chairside cloud sync (Supabase)
   - The shop signs in with one email + password. Use the same login on
     every phone in the shop and they all see the same data.
   - The app still works offline: everything is saved on the phone first,
     then sent to the cloud when there is internet.
   - Two phones can change things at the same time: changes are merged
     record by record (newest change wins), so nothing gets overwritten.
   ===================================================================== */

// ⬇️ Paste your own values here (Supabase → Connect). The publishable key is safe to be public.
const SUPABASE_URL = 'https://bvbleiyennvyqpvnvryj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XbaV0qkXG-fyuK5Z8s4GVw_0os2X0VK';

const Sync = (() => {
  const COLS = ['bookings', 'tx', 'services', 'staff'];   // lists merged record by record
  const SETTINGS = ['shop', 'hours', 'voiceReply'];        // merged as one block (newest wins)
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  let client = null, user = null;
  let state = 'off';            // off | signedout | syncing | synced | offline | error
  let lastSync = 0, lastError = '';
  let busy = false, again = false, debounce = null;
  let prev = {}, prevSettings = '';

  const configured = () => !!(SUPABASE_URL && SUPABASE_KEY);

  /* ---------- change tracking ---------- */
  // Each record gets "u" = when it last changed. Deleted records leave a note in S.del,
  // so a deletion on one phone also removes the record on the others.
  const keyOf = o => { const c = Object.assign({}, o); delete c.u; return JSON.stringify(c); };
  const settingsKey = s => JSON.stringify(SETTINGS.map(k => s[k]));
  function snapshot() {
    prev = {};
    for (const c of COLS) for (const it of (S[c] || [])) prev[it.id] = keyOf(it);
    prevSettings = settingsKey(S);
  }
  function stamp() {
    const now = Date.now(), seen = {};
    S.del = S.del || {};
    for (const c of COLS) for (const it of (S[c] || [])) {
      seen[it.id] = 1;
      if (prev[it.id] !== keyOf(it)) { it.u = now; delete S.del[it.id]; }
    }
    for (const id in prev) if (!seen[id]) S.del[id] = now;
    if (settingsKey(S) !== prevSettings) S.su = now;
    // Forget deletion notes older than 120 days.
    const old = now - 120 * 864e5;
    for (const id in S.del) if (S.del[id] < old) delete S.del[id];
    snapshot();
  }

  /* ---------- merging two copies ---------- */
  function merge(a, b) {
    const out = Object.assign({}, a), del = Object.assign({}, a.del || {});
    for (const [id, t] of Object.entries(b.del || {})) if (!(del[id] >= t)) del[id] = t;
    for (const c of COLS) {
      const m = new Map();
      for (const it of [...(a[c] || []), ...(b[c] || [])]) {
        const cur = m.get(it.id);
        if (!cur || (it.u || 0) > (cur.u || 0)) m.set(it.id, it);
      }
      out[c] = [...m.values()].filter(it => !(del[it.id] >= (it.u || 0)));
    }
    if ((b.su || 0) > (a.su || 0)) { for (const k of SETTINGS) out[k] = b[k]; out.su = b.su; }
    out.del = del; out.demo = false;
    if (!out.staff.length) out.staff = a.staff.length ? a.staff : b.staff;
    if (!out.services.length) out.services = a.services.length ? a.services : b.services;
    return out;
  }
  // A short fingerprint of what a copy contains, so we only upload when something really changed.
  const fingerprint = d => JSON.stringify([
    ...COLS.map(c => (d[c] || []).map(it => it.id + ':' + (it.u || 0)).sort()),
    d.su || 0, Object.keys(d.del || {}).sort()]);

  /* ---------- talking to Supabase ---------- */
  function loadLib() {
    if (window.supabase) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIB; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function safeRender() {
    // Don't redraw under someone's fingers: wait if a form is open or a field is being typed in.
    const busyUI = document.querySelector('#sheet.open') || (document.activeElement && document.activeElement.matches('input,select'));
    if (busyUI) { pendingRender = true; return; }
    render();
  }
  let pendingRender = false;
  setInterval(() => { if (pendingRender && !document.querySelector('#sheet.open') && !(document.activeElement && document.activeElement.matches('input,select'))) { pendingRender = false; render(); } }, 1500);

  async function syncNow() {
    if (!client || !user) return;
    if (busy) { again = true; return; }
    busy = true; state = 'syncing'; refresh();
    // Never upload sample data: a signed-in phone that still shows samples starts clean instead.
    if (S.demo) { S = baseData(); snapshot(); writeLocal(); UI.date = today(); safeRender(); }
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
      const { data, error } = await client.from('shops').select('data').eq('owner', user.id).maybeSingle();
      if (error) throw error;
      const remote = data ? migrate(data.data) : null;
      if (remote) {
        const merged = merge(S, remote);
        if (fingerprint(merged) !== fingerprint(S)) { S = migrate(merged); snapshot(); writeLocal(); safeRender(); }
      }
      if (!remote || fingerprint(S) !== fingerprint(remote)) {
        const { error: e2 } = await client.from('shops').upsert({ owner: user.id, data: S, updated_at: new Date().toISOString() });
        if (e2) throw e2;
      }
      lastSync = Date.now(); lastError = ''; state = 'synced';
    } catch (e) {
      state = e.offline || !navigator.onLine ? 'offline' : 'error';
      lastError = e.message || String(e);
      console.warn('Sync failed:', e);
    } finally {
      busy = false; refresh();
      if (again) { again = false; setTimeout(syncNow, 300); }
    }
  }

  function changed() {
    if (!user || S.demo) return;
    clearTimeout(debounce); debounce = setTimeout(syncNow, 1200);
  }

  async function init() {
    snapshot();
    if (!configured()) { state = 'off'; return; }
    try { await loadLib(); } catch (e) { state = 'offline'; refresh(); window.addEventListener('online', init, { once: true }); return; }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    client.auth.onAuthStateChange((event, session) => {
      user = session ? session.user : null;
      if (event === 'PASSWORD_RECOVERY') setTimeout(askNewPassword, 300);
      if (!user) { state = 'signedout'; refresh(); return; }
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(syncNow, 50);
    });
    setInterval(() => { if (user && document.visibilityState === 'visible') syncNow(); }, 20000);
    document.addEventListener('visibilitychange', () => { if (user && document.visibilityState === 'visible') syncNow(); });
    window.addEventListener('online', () => user && syncNow());
  }

  /* ---------- sign in / out ---------- */
  const val = id => (document.getElementById(id) || {}).value || '';
  async function signIn(create) {
    if (!client) return toast('Cloud is not reachable right now');
    const email = val('c_email').trim(), password = val('c_pass');
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email');
    if (password.length < 8) return toast('Password needs at least 8 characters');
    // After signing in, sample data is cleared (in syncNow); real data on this phone is kept and merged.
    const redirect = location.origin + location.pathname;
    const r = create
      ? await client.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
      : await client.auth.signInWithPassword({ email, password });
    if (r.error) return toast(r.error.message);
    if (create && !r.data.session) return toast('Check your email and tap the link, then sign in here');
    toast('Signed in — syncing');
  }
  async function forgot() {
    const email = val('c_email').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Type your email first');
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    toast(error ? error.message : 'Check your email for a reset link');
  }
  async function askNewPassword() {
    const pw = prompt('Choose a new password (at least 8 characters)');
    if (!pw || pw.length < 8) return toast('Password not changed');
    const { error } = await client.auth.updateUser({ password: pw });
    toast(error ? error.message : 'Password updated');
  }
  async function signOut() {
    if (!confirm('Sign out on this phone? Your data stays saved in the cloud and on this phone.')) return;
    await client.auth.signOut(); user = null; state = 'signedout'; refresh();
  }

  /* ---------- UI ---------- */
  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 10 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : new Date(t).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' });
  }
  function status() {
    return { syncing: 'Syncing…', synced: 'Synced ' + (lastSync ? ago(lastSync) : ''), offline: 'Offline — will sync later', error: 'Sync problem — tap Sync now', signedout: 'Not signed in', off: '' }[state] || '';
  }
  function badge() { return user ? ' · ' + ({ syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', error: 'Not synced' }[state] || '') : ''; }
  function card() {
    if (!configured()) return '';
    if (!user) return `<div class="card"><h2 style="margin-bottom:6px">Cloud backup & other phones</h2>
      <p class="sub" style="margin-top:0">Sign in to back everything up and use the same shop on more than one phone. Use the same login on every phone in the shop.</p>
      <label>Email<input id="c_email" type="email" autocomplete="username" inputmode="email"></label>
      <label>Password<input id="c_pass" type="password" autocomplete="current-password" minlength="8"></label>
      <div class="grid2" style="margin:0"><button class="btn" data-act="cloudIn">Sign in</button><button class="btn ghost" data-act="cloudUp">Create account</button></div>
      <button class="linkbtn" style="margin-top:8px" data-act="cloudForgot">Forgot password?</button></div>`;
    return `<div class="card"><h2 style="margin-bottom:6px">Cloud backup & other phones</h2>
      <div class="kv" style="margin-bottom:12px"><span>Account</span><b>${esc(user.email || '')}</b><span>Status</span><b class="${state === 'error' ? 'red' : state === 'synced' ? 'green' : ''}">${esc(status())}</b></div>
      ${state === 'error' && lastError ? `<p class="sub red" style="margin-top:0">${esc(lastError)}</p>` : ''}
      <div class="grid2" style="margin:0"><button class="btn ghost" data-act="cloudSync">Sync now</button><button class="btn ghost danger" data-act="cloudOut">Sign out</button></div></div>`;
  }
  function refresh() {
    const l = document.getElementById('todayLabel');
    if (l) l.textContent = new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long' }) + badge();
    if (UI.tab === 'settings' && !document.querySelector('#sheet.open') && !(document.activeElement && document.activeElement.matches('#c_email,#c_pass'))) safeRender();
  }

  Object.assign(ACT, {
    cloudIn: () => signIn(false), cloudUp: () => signIn(true), cloudForgot: forgot,
    cloudOut: signOut, cloudSync: () => syncNow()
  });

  return { init, stamp, snapshot, changed, card, badge, signedIn: () => !!user, syncNow, _merge: merge };
})();

Sync.init();

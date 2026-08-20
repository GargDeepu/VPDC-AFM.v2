/* VPDC AFM admin dashboard.
   Requires the signed-in Supabase user's auth id to be present in the
   public.admin_users table (see supabase_migration.sql). Anyone else who
   logs in here — even with a valid student account — is refused by the
   admin_list_students() RPC on the server side (SECURITY DEFINER check),
   not just hidden in the UI. */
(function () {
  const CFG = { url: 'https://qzsuqxgsnzmmzzwujhps.supabase.co', key: 'sb_publishable_aF3Tmp_V4yHaop8j9Hu4BA_nB8YEU9O' };
  const client = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true } });
  const app = document.getElementById('admin-app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  let rows = [];

  function fmtDuration(totalSeconds) {
    const n = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${n}s`;
  }
  function fmtDate(iso) { if (!iso) return '\u2014'; const d = new Date(iso); return isNaN(d) ? '\u2014' : d.toLocaleString(); }

  function loginScreen(msg) {
    app.innerHTML = `<div class="admin-login"><div class="admin-card">
      <h1><i class="fa-solid fa-lock"></i> VPDC AFM Admin</h1>
      <p>Sign in with an admin-authorised email and password to view student records.</p>
      <form id="admin-login-form">
        <label>Email</label><input name="email" type="email" required autocomplete="email">
        <label>Password</label><input name="password" type="password" required autocomplete="current-password">
        <button type="submit">Sign In</button>
      </form>
      <div class="admin-msg" id="admin-msg">${msg ? esc(msg) : ''}</div>
    </div></div>`;
    document.getElementById('admin-login-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const email = String(f.get('email') || '').trim().toLowerCase();
      const password = String(f.get('password') || '');
      const msgEl = document.getElementById('admin-msg');
      msgEl.style.color = '#a5f3fc'; msgEl.textContent = 'Signing in\u2026';
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) { msgEl.style.color = '#fca5a5'; msgEl.textContent = error.message; return; }
      await loadDashboard();
    };
  }

  function render(list) {
    const total = list.length;
    const totalSecondsAll = list.reduce((s, r) => s + Number(r.total_seconds || 0), 0);
    const activeToday = list.filter(r => r.last_active_at && (Date.now() - new Date(r.last_active_at).getTime()) < 86400000).length;
    app.innerHTML = `<div class="admin-shell">
      <div class="admin-top">
        <div><div class="sub">VPDC \u2022 AFM</div><h1>Student Admin Dashboard</h1></div>
        <div class="admin-actions">
          <button class="admin-btn" id="refresh-btn"><i class="fa-solid fa-rotate"></i> Refresh</button>
          <button class="admin-btn" id="csv-btn"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
          <button class="admin-btn danger" id="logout-btn"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
        </div>
      </div>
      <div class="admin-stats">
        <div class="admin-stat"><b>${total}</b><span>Total Students</span></div>
        <div class="admin-stat"><b>${activeToday}</b><span>Active in last 24h</span></div>
        <div class="admin-stat"><b>${fmtDuration(totalSecondsAll)}</b><span>Combined Time on App</span></div>
      </div>
      <div class="admin-search"><input id="search-box" placeholder="Search by name, city, email or phone\u2026"></div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Name</th><th>City</th><th>Email</th><th>Phone</th><th>Password</th><th>Last Used</th><th>Total Time Spent</th></tr></thead>
          <tbody id="admin-tbody"></tbody>
        </table>
      </div>
      <p style="color:#64748b;font-size:11px;margin-top:14px;line-height:1.6">
        Passwords are hashed by Supabase Auth and are never stored or retrievable in plain text \u2014 by anyone, including this
        dashboard or Anthropic/Supabase support. This is a standard, non-negotiable security property of password authentication,
        not a limitation of this app. If a student is locked out, use "Forgot password" on the login screen, or trigger a reset from
        Supabase Dashboard \u2192 Authentication \u2192 Users.
      </p>
    </div>`;

    const tbody = document.getElementById('admin-tbody');
    function draw(filtered) {
      if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="7" class="admin-empty">No matching students.</td></tr>`; return; }
      tbody.innerHTML = filtered.map(r => `<tr>
        <td>${esc(r.name || '\u2014')}</td>
        <td>${esc(r.place || '\u2014')}</td>
        <td>${esc(r.email || '\u2014')}</td>
        <td>${esc(r.phone || '\u2014')}</td>
        <td class="pw-hidden">Hidden (never stored)</td>
        <td>${fmtDate(r.last_active_at)}</td>
        <td>${fmtDuration(r.total_seconds)}</td>
      </tr>`).join('');
    }
    draw(list);
    document.getElementById('search-box').oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) { draw(list); return; }
      draw(list.filter(r => [r.name, r.place, r.email, r.phone].some(v => String(v || '').toLowerCase().includes(q))));
    };
    document.getElementById('refresh-btn').onclick = loadDashboard;
    document.getElementById('logout-btn').onclick = async () => { await client.auth.signOut(); location.reload(); };
    document.getElementById('csv-btn').onclick = () => {
      const head = ['Name', 'City', 'Email', 'Phone', 'Last Used', 'Total Time Spent (seconds)'];
      const body = list.map(r => [r.name, r.place, r.email, r.phone, r.last_active_at || '', Math.floor(r.total_seconds || 0)]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
      const csv = [head.join(','), ...body].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'vpdc-afm-students.csv'; a.click();
    };
  }

  async function loadDashboard() {
    app.innerHTML = `<div class="admin-login"><div class="admin-card"><h1><i class="fa-solid fa-spinner fa-spin"></i> Loading\u2026</h1><p>Fetching student records.</p></div></div>`;
    const { data, error } = await client.rpc('admin_list_students');
    if (error) {
      await client.auth.signOut();
      loginScreen('Access denied: this account is not authorised as an admin, or the session expired. ' + error.message);
      return;
    }
    rows = data || [];
    render(rows);
  }

  (async () => {
    const { data } = await client.auth.getSession();
    if (data.session) await loadDashboard(); else loginScreen();
  })();
})();

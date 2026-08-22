/* VPDC AFM authentication layer (email + password).
   Flow: Sign up (name, mobile, city, email, password) -> email OTP verification
   -> unique student record created/linked to the Supabase auth user id ->
   authenticated learning session. Login: email + password. Supabase persists
   the session in the browser automatically (persistSession:true in app.js),
   so returning students are taken straight back into the quiz.
   Forgot/reset password is a standard emailed reset link. */
(function () {
  window.__VPDC_AUTH_ACTIVE__ = true;
  if (typeof db === 'undefined') return;
  const client = db;
  const redirectTo = window.location.origin + window.location.pathname;
  let pendingSignup = null; // {name, phone, place, email, password}

  const setMsg = (m, bad = false) => { const el = document.getElementById('auth-msg'); if (el) { el.textContent = m; el.style.color = bad ? '#fca5a5' : '#a5f3fc'; } };
  const card = (body) => {
    document.body.innerHTML = `<div class="login-page"><div class="login-glow"></div><section class="login-card">${vpcLogo('large')}<div class="login-kicker">CA FINAL \u2022 PAPER 2</div><h1>Advanced Financial Management</h1>${body}<div id="auth-msg" class="login-error"></div></section></div>`;
  };
  const togglePw = (inputId) => { const el = document.getElementById(inputId); if (el) el.type = el.type === 'password' ? 'text' : 'password'; };
  window.__togglePw = togglePw;

  function showLogin() {
    card(`<p class="login-copy">Log in with your registered email and password to continue your saved progress.</p>
      <form id="login-form">
        <label>Email</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com">
        <div class="pw-row"><label>Password</label><input id="login-pw" name="password" type="password" required autocomplete="current-password" placeholder="Your password"><button type="button" class="pw-toggle" onclick="__togglePw('login-pw')"><i class="fa-regular fa-eye"></i></button></div>
        <span class="auth-forgot" id="go-forgot">Forgot password?</span>
        <button class="primary-btn" type="submit"><i class="fa-solid fa-right-to-bracket"></i> Log In</button>
      </form>
      <div class="auth-switch">New here? <a id="go-signup">Create a student account</a></div>`);
    document.getElementById('go-signup').onclick = showSignup;
    document.getElementById('go-forgot').onclick = showForgot;
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const email = String(f.get('email') || '').trim().toLowerCase();
      const password = String(f.get('password') || '');
      setMsg('Logging in\u2026');
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) { setMsg(error.message, true); return; }
      await afterAuth(data.user);
    };
  }
  window.showLogin = showLogin;

  function showSignup() {
    card(`<p class="login-copy">Create your VPDC student account once. Your progress, answers and activity are saved automatically under your unique student ID.</p>
      <form id="signup-form">
        <label>Full Name</label><input name="name" required minlength="2" autocomplete="name" placeholder="Your name">
        <label>Mobile Number</label><input name="phone" required inputmode="tel" autocomplete="tel" placeholder="Your mobile number">
        <label>City / Place</label><input name="place" required minlength="2" autocomplete="address-level2" placeholder="Your city or place">
        <label>Email</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com">
        <div class="pw-row"><label>Password</label><input id="signup-pw" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"><button type="button" class="pw-toggle" onclick="__togglePw('signup-pw')"><i class="fa-regular fa-eye"></i></button></div>
        <button class="primary-btn" type="submit"><i class="fa-solid fa-user-plus"></i> Create Account &amp; Send OTP</button>
      </form>
      <div class="auth-switch">Already registered? <a id="go-login">Log in</a></div>`);
    document.getElementById('go-login').onclick = showLogin;
    document.getElementById('signup-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const name = String(f.get('name') || '').trim();
      const phone = String(f.get('phone') || '').trim();
      const place = String(f.get('place') || '').trim();
      const email = String(f.get('email') || '').trim().toLowerCase();
      const password = String(f.get('password') || '');
      if (phone.replace(/\D/g, '').length < 7) { setMsg('Please enter a valid mobile number.', true); return; }
      pendingSignup = { name, phone, place, email, password };
      setMsg('Creating your account and sending a verification code\u2026');
      const { error } = await client.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: redirectTo } });
      if (error) { setMsg(error.message, true); return; }
      showSignupOtp();
    };
  }
  window.showSignup = showSignup;

  function showSignupOtp() {
    card(`<p class="login-copy">We sent an 8-digit verification code to <strong>${esc(pendingSignup.email)}</strong>. Enter it below to activate your account.</p>
      <form id="otp-form">
        <label>Email OTP</label><input name="otp" required inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]{8}" placeholder="Enter 8-digit code">
        <button class="primary-btn" type="submit"><i class="fa-solid fa-circle-check"></i> Verify &amp; Continue</button>
        <button id="resend-otp" class="auth-back" type="button">Resend code</button>
      </form>
      <p class="auth-hint">Didn't get an email? Check spam, or use "Resend code".</p>`);
    document.getElementById('otp-form').onsubmit = async (e) => {
      e.preventDefault();
      const token = String(new FormData(e.target).get('otp') || '').trim();
      if (!/^\d{8}$/.test(token)) { setMsg('Enter the 8-digit code.', true); return; }
      setMsg('Verifying\u2026');
      const { data, error } = await client.auth.verifyOtp({ email: pendingSignup.email, token, type: 'signup' });
      if (error) { setMsg(error.message, true); return; }
      const user = data?.user || (await client.auth.getUser()).data.user;
      const r = await client.rpc('link_authenticated_student', { p_name: pendingSignup.name, p_phone: pendingSignup.phone, p_place: pendingSignup.place, p_email: pendingSignup.email });
      if (r.error) { setMsg(r.error.message, true); return; }
      await bootAuthenticated(user, r.data);
    };
    document.getElementById('resend-otp').onclick = async () => {
      setMsg('Resending code\u2026');
      const { error } = await client.auth.resend({ type: 'signup', email: pendingSignup.email });
      setMsg(error ? error.message : 'A new code has been sent.', !!error);
    };
  }

  function showForgot() {
    card(`<p class="login-copy">Enter the email you registered with. We'll send you a link to reset your password.</p>
      <form id="forgot-form">
        <label>Email</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com">
        <button class="primary-btn" type="submit"><i class="fa-solid fa-paper-plane"></i> Send Reset Link</button>
        <button id="back-login" class="auth-back" type="button">Back to login</button>
      </form>`);
    document.getElementById('back-login').onclick = showLogin;
    document.getElementById('forgot-form').onsubmit = async (e) => {
      e.preventDefault();
      const email = String(new FormData(e.target).get('email') || '').trim().toLowerCase();
      setMsg('Sending reset link\u2026');
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) { setMsg(error.message, true); return; }
      card(`<p class="login-copy">If an account exists for <strong>${esc(email)}</strong>, a password reset link has been sent. Open it on this device to set a new password.</p><button id="back-login2" class="primary-btn" type="button">Back to login</button>`);
      document.getElementById('back-login2').onclick = showLogin;
    };
  }
  window.showForgot = showForgot;

  function showResetPassword() {
    card(`<p class="login-copy">Enter a new password for your account.</p>
      <form id="reset-form">
        <div class="pw-row"><label>New Password</label><input id="reset-pw" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"><button type="button" class="pw-toggle" onclick="__togglePw('reset-pw')"><i class="fa-regular fa-eye"></i></button></div>
        <button class="primary-btn" type="submit"><i class="fa-solid fa-key"></i> Set New Password</button>
      </form>`);
    document.getElementById('reset-form').onsubmit = async (e) => {
      e.preventDefault();
      const password = String(new FormData(e.target).get('password') || '');
      setMsg('Updating password\u2026');
      const { error } = await client.auth.updateUser({ password });
      if (error) { setMsg(error.message, true); return; }
      setMsg('Password updated. Redirecting\u2026');
      setTimeout(() => { window.location.hash = ''; ensure(); }, 900);
    };
  }

  async function afterAuth(user) {
    let { data: student, error } = await client.from('students').select('*').eq('auth_user_id', user.id).maybeSingle();
    if (error) { renderError('Unable to load your student profile', error.message); return; }
    if (!student) {
      const meta = user.user_metadata || {};
      const r = await client.rpc('link_authenticated_student', { p_name: meta.full_name || '', p_phone: '', p_place: '', p_email: user.email });
      if (r.error) { renderError('Unable to set up your student profile', r.error.message); return; }
      student = r.data;
    }
    await bootAuthenticated(user, student);
  }

  async function bootAuthenticated(user, studentOverride) {
    const { data, error } = await client.rpc('start_learning_session', { p_quiz_key: CFG.quiz });
    if (error) { renderError('Unable to start your VPDC session', error.message); return; }
    const student = studentOverride || data.student;
    S.student = student; S.attempt = data.attempt; S.sessionId = data.session.id; S.questions = loadQuestions();
    if (!S.questions.length) { renderError('Question bank could not be loaded', 'The AFM question bank was not available in this browser session.'); return; }
    S.i = Math.min(Number(S.attempt.current_question_index || 0), S.questions.length - 1);
    S.answers = {}; S.hidden = {}; S.lifeline5050 = {}; S.expertUsed = {}; S.pollUsed = {};
    const a = await client.rpc('load_authenticated_attempt_answers', { p_attempt_id: S.attempt.id });
    if (!a.error) (a.data || []).forEach(x => {
      S.answers[String(x.question_id)] = x;
      S.hidden[String(x.question_id)] = x.hidden_options || [];
      if (x.used_5050) S.lifeline5050[String(x.question_id)] = true;
    });
    S.started = Date.now() - Number(S.attempt.total_seconds || 0) * 1000;
    S.questionStarted = Date.now();
    render();
  }

  async function ensure() {
    const { data } = await client.auth.getSession();
    if (!data.session) { showLogin(); return; }
    await afterAuth(data.session.user);
  }

  window.vpdcPersistAnswer = async (a) => {
    if (!S.attempt) return false;
    const { error } = await client.rpc('save_authenticated_answer', {
      p_attempt_id: S.attempt.id, p_question_id: a.question_id, p_question_index: a.question_index,
      p_selected_option: a.selected_option, p_correct_option: a.correct_option, p_is_correct: a.is_correct,
      p_skipped: !!a.skipped, p_marked: !!a.marked_for_review, p_hidden_options: a.hidden_options || S.hidden[a.question_id] || [],
      p_used_5050: !!a.used_5050, p_used_expert: !!a.used_expert, p_used_poll: !!a.used_poll, p_seconds_spent: Math.floor(a.seconds_spent || 0)
    });
    if (error) console.error('save_authenticated_answer', error);
    return !error;
  };

  window.vpdcPersistProgress = async (status = 'active') => {
    if (!S.attempt) return false;
    const { error } = await client.rpc('save_authenticated_progress', {
      p_attempt_id: S.attempt.id, p_current_index: S.i, p_current_question_id: S.questions[S.i]?.id || '',
      p_total_seconds: Math.floor((Date.now() - S.started) / 1000), p_status: status
    });
    if (error) console.error('save_authenticated_progress', error);
    return !error;
  };

  window.vpdcLogEvent = async (type, q, a) => {
    if (!S.sessionId || !S.attempt || !q) return;
    const { error } = await client.rpc('record_answer_event', {
      p_session_id: S.sessionId, p_attempt_id: S.attempt.id, p_question_id: String(q.id), p_question_index: S.i,
      p_event_type: type, p_selected_option: a?.selected_option ?? null, p_is_correct: a?.is_correct ?? null,
      p_skipped: !!a?.skipped, p_marked: !!a?.marked_for_review, p_hidden_options: a?.hidden_options || S.hidden[q.id] || [],
      p_used_5050: !!a?.used_5050, p_used_expert: !!a?.used_expert, p_used_poll: !!a?.used_poll, p_seconds_spent: Math.floor(a?.seconds_spent || 0)
    });
    if (error) console.error('record_answer_event', error);
  };

  window.vpdcStartNewAttempt = async () => {
    await client.rpc('start_new_attempt_authenticated', { p_quiz_key: CFG.quiz }).catch(() => {});
    location.reload();
  };

  window.vpdcLogout = async () => { await client.auth.signOut(); location.href = redirectTo; };

  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showResetPassword();
  });

  ensure();
})();

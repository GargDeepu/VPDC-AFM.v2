/* VPDC AFM — quiz engine + UI. Single consolidated implementation.
   Authentication (signup/login/OTP/forgot-password) lives in auth.js.
   auth.js calls bootAuthenticated(user, student) once a verified session exists,
   then this file owns question rendering, navigation, lifelines and local state.
   Persistence hooks (window.vpdcPersistAnswer / vpdcPersistProgress / vpdcLogEvent)
   are provided by auth.js so this file never talks to Supabase directly. */

const CFG = {
  url: 'https://qzsuqxgsnzmmzzwujhps.supabase.co',
  key: 'sb_publishable_aF3Tmp_V4yHaop8j9Hu4BA_nB8YEU9O',
  quiz: 'afm-master',
  feedback: 'https://docs.google.com/forms/d/e/1FAIpQLSdN2TbASV9tvzUfvImDBDD3XHRE4JWsU6m5YCK7eLDU5wZ-nQ/viewform?usp=publish-editor'
};
const db = window.supabase.createClient(CFG.url, CFG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let S = {
  student: null,
  attempt: null,
  sessionId: null,
  questions: [],
  i: 0,
  answers: {},
  started: Date.now(),
  questionStarted: Date.now(),
  timer: null,
  lifeline5050: {},
  expertUsed: {},
  pollUsed: {},
  hidden: {},
  passageOpen: true
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const sec = (n) => { n = Math.max(0, Math.floor(n || 0)); return `${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; };

function vpcLogo(size = 'small') {
  return `<div class="vpc-logo ${size}"><img class="vpc-logo-img" src="assets/vpdc-logo.png" alt="VPDC \u2013 Vinijyn Pro Classes"></div>`;
}
window.vpcLogo = vpcLogo;

function normalizeQuestions(raw) {
  return raw.map((q, i) => ({
    id: String(q.id ?? q.questionId ?? i + 1),
    text: q.question ?? q.text ?? q.questionText ?? '',
    options: Array.isArray(q.options) ? q.options : (q.answers ?? []),
    correct: Number(q.correctAnswer ?? q.correct ?? q.answer ?? q.correctOption ?? -1),
    caseText: q.passage ?? q.caseScenarioText ?? '',
    caseId: String(q.caseScenarioNum ?? q.caseId ?? q.caseNumber ?? q.scenarioId ?? ''),
    caseTitle: q.caseScenarioTitle ?? '',
    type: q.type ?? '',
    explanation: q.explanation ?? '',
    raw: q
  }));
}

function loadQuestions() {
  const raw = Array.isArray(window.AFM_MCQS_QUESTIONS) && window.AFM_MCQS_QUESTIONS.length
    ? window.AFM_MCQS_QUESTIONS
    : (Array.isArray(window.FR_MCQS_QUESTIONS) ? window.FR_MCQS_QUESTIONS : []);
  return normalizeQuestions(raw);
}
window.loadQuestions = loadQuestions;

function renderError(title, text) {
  document.body.innerHTML = `<div class="login-page"><section class="login-card">${vpcLogo('large')}<div class="login-kicker">VPDC \u2022 AFM</div><h1>${esc(title)}</h1><p class="login-copy">${esc(text)}</p><button class="primary-btn" onclick="location.reload()"><i class="fa-solid fa-rotate-right"></i> Refresh</button></section></div>`;
}
window.renderError = renderError;

function answerState(q) {
  return S.answers[q.id] || { question_id: q.id, question_index: S.i, selected_option: null, correct_option: q.correct, is_correct: null, skipped: false, marked_for_review: false, hidden_options: S.hidden[q.id] || [], used_5050: false, used_expert: false, used_poll: false, seconds_spent: 0 };
}

function paletteStatus(q, j) {
  const a = S.answers[q.id];
  if (j === S.i) return 'current';
  if (!a) return '';
  if (a.marked_for_review) return 'marked';
  if (a.skipped) return 'skipped';
  if (a.selected_option !== null && a.selected_option !== undefined) return a.is_correct ? 'answered' : 'wrong';
  return '';
}

function stats() {
  const values = Object.values(S.answers);
  const answered = values.filter(a => a.selected_option !== null && a.selected_option !== undefined);
  const correct = answered.filter(a => a.is_correct).length;
  return { attempted: answered.length, correct, wrong: answered.length - correct, skipped: values.filter(a => a.skipped).length, accuracy: answered.length ? Math.round(correct / answered.length * 100) : 0, time: Math.floor((Date.now() - S.started) / 1000) };
}

function qCaseId(q) { return String(q.caseId || '0'); }
function caseQuestions() { const q = S.questions[S.i]; if (!q || !q.caseId) return []; return S.questions.map((x, i) => ({ x, i })).filter(z => qCaseId(z.x) === qCaseId(q)); }
function caseUsed5050(q) { const id = qCaseId(q); return Object.values(S.answers).some(a => a && a.used_5050 && S.questions.some(x => String(x.id) === String(a.question_id) && qCaseId(x) === id)); }

function studentChip() {
  const name = S.student?.name ? String(S.student.name).trim() : '';
  if (!name) return '';
  return `<div class="student-name-chip" title="Logged in student"><i class="fa-regular fa-circle-user"></i>${esc(name)}</div>`;
}

function render() {
  const q = S.questions[S.i]; if (!q) return;
  const a = answerState(q);
  if (S.timer) clearInterval(S.timer);
  const hidden = S.hidden[q.id] || [];
  const answered = a.selected_option !== null && a.selected_option !== undefined;

  const opts = q.options.map((o, j) => {
    const text = typeof o === 'object' ? (o.text ?? o.label ?? JSON.stringify(o)) : o;
    let c = 'vpdc-option';
    if (hidden.includes(j)) c += ' eliminated';
    if (answered && j === q.correct) c += ' correct';
    if (answered && j === a.selected_option && j !== q.correct) c += ' wrong';
    return `<button class="${c}" data-opt="${j}" ${answered || hidden.includes(j) ? 'disabled' : ''}><span class="letter">${String.fromCharCode(65 + j)}</span><span>${hidden.includes(j) ? 'Option eliminated by 50:50' : esc(text).replace(/^\s*\([a-d]\)\s*/i, '')}</span></button>`;
  }).join('');

  const cList = caseQuestions();
  const scenarioOptions = [...new Map(S.questions.filter(x => x.caseId).map(x => [qCaseId(x), x.caseTitle || `Case Scenario ${x.caseId}`])).entries()]
    .map(([id, t]) => `<option value="${id}">${esc(t)}</option>`).join('');

  document.body.innerHTML = `<div class="vpdc-shell">
    <header class="vpdc-header">
      <div class="vpdc-title"><span class="kicker">CA FINAL | PAPER 2</span><span class="subject">Advanced Financial Management</span></div>
      <div class="vpdc-center"><label>Case Scenario</label><select id="scenario-select"><option value="">${esc(q.caseTitle || 'Current Case')}</option>${scenarioOptions}</select></div>
      <div class="vpdc-tools">${studentChip()}<div class="vpdc-timer"><i class="fa-regular fa-clock"></i> <span id="timer-display">${sec((Date.now()-S.started)/1000).slice(3)}</span></div><div class="vpdc-score">Q:${S.i+1}/${S.questions.length}</div><button id="logout-btn" class="vpdc-logout" title="Log out"><i class="fa-solid fa-right-from-bracket"></i></button><div class="vpdc-mini">${vpcLogo('mini')}</div></div>
    </header>
    <div class="vpdc-lifelines">
      <button id="life-5050" class="vpdc-life cyan"><span class="big">50:50</span><span>once per case</span></button>
      <button id="life-expert" class="vpdc-life gold"><i class="fa-solid fa-user-tie"></i> Expert</button>
      <button id="life-poll" class="vpdc-life purple"><i class="fa-solid fa-chart-simple"></i> Poll</button>
      <div class="vpdc-life-note">Lifelines are saved with your attempt</div>
    </div>
    <main class="vpdc-main">
      <section class="vpdc-content">
        ${q.caseText ? `<section class="vpdc-card vpdc-case"><div class="vpdc-case-head"><span><i class="fa-solid fa-file-lines"></i> ${esc(q.caseTitle || `Case Scenario ${q.caseId}`)}</span><button id="toggle-passage" class="vpdc-btn">${S.passageOpen ? 'Hide Context' : 'Show Context'}</button></div><div class="vpdc-case-body" id="case-body" style="display:${S.passageOpen?'block':'none'}">${esc(q.caseText)}</div></section>` : ''}
        <section class="vpdc-card">
          <div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:12px"><span>${q.type ? esc(q.type) : 'Case Scenario'}</span><span id="saved">\u2601 Saved</span></div>
          <div class="vpdc-question"><span class="vpdc-qnum">Q${S.i+1}.</span> ${esc(q.text).replace(/^Q\d+[\.\)]\s*/, '')}</div>
          <div class="vpdc-options">${opts}</div>
        </section>
      </section>
      <aside class="vpdc-sidebar">
        <section class="vpdc-card">
          <div class="vpdc-side-title"><h3>Case Questions</h3><button id="save-now" class="vpdc-btn">Save</button></div>
          <div class="vpdc-side-note">${q.caseId ? 'Questions in this case only' : 'No case-specific questions for this item.'}</div>
          <div class="vpdc-case-list">${cList.map(z => `<button class="vpdc-case-q ${paletteStatus(z.x,z.i)}" data-case-go-side="${z.i}">${z.i+1}</button>`).join('')}</div>
        </section>
      </aside>
    </main>
    <footer class="vpdc-bottom">
      <button id="prev" class="vpdc-btn"><i class="fa-solid fa-arrow-left"></i> Prev</button>
      <div class="vpdc-bottom-center">
        <button id="mark" class="vpdc-btn">${a.marked_for_review ? '\u2605 Marked' : '\u2606 Mark'}</button>
        <button id="analysis" class="vpdc-btn analysis"><i class="fa-solid fa-chart-line"></i> Analysis</button>
        <button id="palette" class="vpdc-btn"><i class="fa-solid fa-table-cells-large"></i> Palette</button>
        <button id="case-jump" class="vpdc-btn"><i class="fa-solid fa-arrow-right-arrow-left"></i> Case Jump</button>
      </div>
      <button id="next" class="vpdc-btn primary">${S.i===S.questions.length-1?'Finish':'Next / Skip'} <i class="fa-solid fa-arrow-right"></i></button>
    </footer>
    <div class="vpdc-footer-credit">Created by Mr. Divyanshu Garg</div>
  </div>`;

  document.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => choose(+b.dataset.opt));
  document.querySelectorAll('[data-case-go-side]').forEach(b => b.onclick = () => { S.i = +b.dataset.caseGoSide; S.questionStarted = Date.now(); render(); });
  $('#prev').onclick = () => move(-1);
  $('#next').onclick = () => move(1);
  $('#mark').onclick = toggleMark;
  $('#analysis').onclick = analysis;
  $('#palette').onclick = openPalette;
  $('#case-jump').onclick = caseJump;
  $('#save-now').onclick = () => save('active');
  $('#life-5050').onclick = use5050;
  $('#life-expert').onclick = useExpert;
  $('#life-poll').onclick = usePoll;
  $('#logout-btn').onclick = async () => { if (confirm('Log out of VPDC AFM? Your progress is already saved.')) await window.vpdcLogout?.(); };
  $('#scenario-select').onchange = (e) => { const id = e.target.value; if (!id) return; const first = S.questions.findIndex(x => qCaseId(x) === id); if (first >= 0) { S.i = first; S.questionStarted = Date.now(); render(); } };
  if ($('#toggle-passage')) $('#toggle-passage').onclick = () => { S.passageOpen = !S.passageOpen; render(); };

  refreshLifelines(q, a);
  S.timer = setInterval(() => { const el = $('#timer-display'); if (el) el.textContent = sec((Date.now()-S.started)/1000).slice(3); }, 1000);
}
window.render = render;

function refreshLifelines(q, a) {
  const b = $('#life-5050'); if (b) { const used = caseUsed5050(q); b.disabled = used || (a.selected_option !== null && a.selected_option !== undefined); }
  const e = $('#life-expert'); if (e) e.disabled = !!S.expertUsed[qCaseId(q)];
  const p = $('#life-poll'); if (p) p.disabled = !!S.pollUsed[qCaseId(q)];
}

async function choose(j) {
  const q = S.questions[S.i], a = answerState(q);
  a.selected_option = j; a.correct_option = q.correct; a.is_correct = j === q.correct; a.skipped = false; a.question_index = S.i;
  a.seconds_spent = Math.floor((a.seconds_spent || 0) + (Date.now() - S.questionStarted) / 1000);
  S.answers[q.id] = a;
  await saveAnswer(a);
  await window.vpdcLogEvent?.('answer_selected', q, a);
  playSound(a.is_correct);
  render();
}

function playSound(correct) {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const c = new C(), o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = correct ? 660 : 220; g.gain.value = .05;
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .12);
  } catch (e) {}
}

async function move(n) {
  const q = S.questions[S.i];
  await save('active');
  await window.vpdcLogEvent?.('navigation', q, S.answers[q.id]);
  if (n > 0 && S.i === S.questions.length - 1) return finish();
  S.i = Math.max(0, Math.min(S.questions.length - 1, S.i + n));
  S.questionStarted = Date.now();
  render();
}

async function toggleMark() {
  const q = S.questions[S.i], a = answerState(q);
  a.marked_for_review = !a.marked_for_review;
  S.answers[q.id] = a;
  await saveAnswer(a);
  await window.vpdcLogEvent?.('mark_toggled', q, a);
  render();
}

async function saveAnswer(a) { await window.vpdcPersistAnswer?.(a); }

async function save(status = 'active') {
  if (!S.attempt) return;
  const ok = await window.vpdcPersistProgress?.(status);
  const x = $('#saved'); if (x) x.textContent = ok === false ? '\u26A0 Save issue' : '\u2601 Saved just now';
}
window.save = save;

function analysis() {
  const x = stats();
  const html = `<div class="vpdc-overlay" id="vpdc-overlay"><div class="vpdc-modal"><div class="vpdc-modal-head"><h2><i class="fa-solid fa-chart-line"></i> Live Performance Analysis</h2><button class="vpdc-modal-close" id="vpdc-close">\u2715</button></div><div class="vpdc-palette-grid" style="grid-template-columns:repeat(3,1fr)"><div class="vpdc-card"><b style="font-size:22px;display:block">${x.attempted}</b><span style="font-size:10px;color:#94a3b8">Attempted</span></div><div class="vpdc-card"><b style="font-size:22px;display:block">${x.correct}</b><span style="font-size:10px;color:#94a3b8">Correct</span></div><div class="vpdc-card"><b style="font-size:22px;display:block">${x.wrong}</b><span style="font-size:10px;color:#94a3b8">Wrong</span></div><div class="vpdc-card"><b style="font-size:22px;display:block">${x.skipped}</b><span style="font-size:10px;color:#94a3b8">Skipped</span></div><div class="vpdc-card"><b style="font-size:22px;display:block">${x.accuracy}%</b><span style="font-size:10px;color:#94a3b8">Accuracy</span></div><div class="vpdc-card"><b style="font-size:22px;display:block">${sec(x.time)}</b><span style="font-size:10px;color:#94a3b8">Total Time</span></div></div><p style="color:#94a3b8;font-size:12px;margin-top:14px">Average time per attempted question: <strong>${x.attempted ? sec(x.time / x.attempted) : '00:00:00'}</strong>. Question ${S.i+1} of ${S.questions.length}. Progress saves continuously.</p></div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  $('#vpdc-close').onclick = () => $('#vpdc-overlay')?.remove();
}
window.analysis = analysis;

function caseJump() {
  const q = S.questions[S.i]; if (!q || !q.caseId) return;
  const list = caseQuestions();
  document.body.insertAdjacentHTML('beforeend', `<div class="vpdc-overlay" id="vpdc-overlay"><div class="vpdc-modal"><div class="vpdc-modal-head"><h2>Jump within ${esc(q.caseTitle || `Case Scenario ${q.caseId}`)}</h2><button class="vpdc-modal-close" id="vpdc-close">\u2715</button></div><p style="color:#94a3b8">Only questions belonging to the current case are shown here.</p><div class="vpdc-case-list">${list.map(z=>`<button class="vpdc-case-q ${paletteStatus(z.x,z.i)}" data-case-go="${z.i}">Q${z.i+1}</button>`).join('')}</div></div></div>`);
  $('#vpdc-close').onclick = () => $('#vpdc-overlay')?.remove();
  document.querySelectorAll('[data-case-go]').forEach(b => b.onclick = () => { S.i = +b.dataset.caseGo; S.questionStarted = Date.now(); $('#vpdc-overlay')?.remove(); render(); });
}
window.caseJump = caseJump;

function openPalette() {
  document.body.insertAdjacentHTML('beforeend', `<div class="vpdc-overlay" id="vpdc-overlay"><div class="vpdc-modal"><div class="vpdc-modal-head"><h2>Question Palette</h2><button class="vpdc-modal-close" id="vpdc-close">\u2715</button></div><p style="color:#94a3b8">Jump to any question in the current AFM practice set.</p><div class="vpdc-palette-grid">${S.questions.map((x,j)=>`<button class="vpdc-palette-q ${paletteStatus(x,j)}" data-palette-go="${j}">${j+1}</button>`).join('')}</div></div></div>`);
  $('#vpdc-close').onclick = () => $('#vpdc-overlay')?.remove();
  document.querySelectorAll('[data-palette-go]').forEach(b => b.onclick = () => { S.i = +b.dataset.paletteGo; S.questionStarted = Date.now(); $('#vpdc-overlay')?.remove(); render(); });
}
window.openPalette = openPalette;

async function use5050() {
  const q = S.questions[S.i], a = answerState(q);
  if (!q || caseUsed5050(q) || (a.selected_option !== null && a.selected_option !== undefined)) return;
  const wrong = q.options.map((_, i) => i).filter(i => i !== q.correct).sort(() => Math.random() - .5).slice(0, 2);
  S.hidden[q.id] = wrong; S.lifeline5050[q.id] = true; a.hidden_options = wrong; a.used_5050 = true;
  S.answers[q.id] = a;
  await saveAnswer(a);
  await window.vpdcLogEvent?.('lifeline_5050', q, a);
  render();
}
window.use5050 = use5050;

function expertText(q) { return q.explanation || 'Use the case facts and the underlying AFM concept to identify the correct option.'; }

function useExpert() {
  const q = S.questions[S.i], id = qCaseId(q); if (S.expertUsed[id]) return;
  S.expertUsed[id] = true;
  window.vpdcLogEvent?.('lifeline_expert', q, S.answers[q.id]);
  document.body.insertAdjacentHTML('beforeend', `<div class="vpdc-overlay" id="vpdc-overlay"><div class="vpdc-modal"><div class="vpdc-modal-head"><h2><i class="fa-solid fa-user-tie"></i> Expert Advice</h2><button class="vpdc-modal-close" id="vpdc-close">\u2715</button></div><p style="color:#cbd5e1;line-height:1.6">${esc(expertText(q)).replace(/\n/g,'<br>')}</p><div style="margin-top:14px;padding:10px;border-radius:10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.18);color:#fcd34d;font-size:11px">Available once for this case scenario.</div></div></div>`);
  $('#vpdc-close').onclick = () => $('#vpdc-overlay')?.remove();
}
window.useExpert = useExpert;

function usePoll() {
  const q = S.questions[S.i], id = qCaseId(q); if (S.pollUsed[id]) return;
  S.pollUsed[id] = true;
  window.vpdcLogEvent?.('lifeline_poll', q, S.answers[q.id]);
  const dist = q.options.map((_, i) => i === q.correct ? 62 : Math.round(38 / (q.options.length - 1)));
  document.body.insertAdjacentHTML('beforeend', `<div class="vpdc-overlay" id="vpdc-overlay"><div class="vpdc-modal"><div class="vpdc-modal-head"><h2><i class="fa-solid fa-chart-simple"></i> Audience Poll</h2><button class="vpdc-modal-close" id="vpdc-close">\u2715</button></div><p style="color:#94a3b8;font-size:12px">Illustrative poll based on question difficulty and the correct answer.</p>${q.options.map((o,i)=>`<div style="margin-top:12px"><div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-bottom:4px"><span>${String.fromCharCode(65+i)}. ${esc(String(o).replace(/^\([a-d]\)\s*/i,''))}</span><strong>${dist[i]}%</strong></div><div style="height:14px;background:rgba(255,255,255,.07);border-radius:99px;overflow:hidden"><div style="height:100%;border-radius:99px;width:${dist[i]}%;background:${i===q.correct?'linear-gradient(90deg,#16a34a,#22c55e)':'linear-gradient(90deg,#7c3aed,#a855f7)'}"></div></div></div>`).join('')}</div></div>`);
  $('#vpdc-close').onclick = () => $('#vpdc-overlay')?.remove();
}
window.usePoll = usePoll;

async function finish() {
  await save('completed');
  const x = stats();
  document.body.innerHTML = `<div class="vpdc-complete"><section class="vpdc-complete-card">${vpcLogo('large')}<div style="font-size:44px;margin:10px 0">\u{1F3C6}</div><div style="color:#fbbf24;letter-spacing:.15em;font-size:11px;font-weight:800">ATTEMPT COMPLETED</div><h1 style="margin:8px 0">Well done, ${esc(S.student?.name || 'Student')}!</h1><p style="color:#94a3b8">You attempted <strong>${x.attempted}</strong> questions with <strong>${x.accuracy}%</strong> accuracy in <strong>${sec(x.time)}</strong>.</p><div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:18px"><button id="review" class="vpdc-btn analysis"><i class="fa-solid fa-chart-line"></i> Review Analysis</button><button id="restart" class="vpdc-btn primary"><i class="fa-solid fa-rotate-right"></i> Start Again</button></div><div class="vpdc-feedback-note"><strong style="color:#e2e8f0">Student Feedback</strong><br>Help us improve this practice set.<br><button id="feedback" class="vpdc-btn" style="margin-top:10px">Open Google Feedback Form \u2197</button></div><div style="margin-top:20px;color:#64748b;font-size:10px">Created by Mr. Divyanshu Garg</div></section></div>`;
  $('#review').onclick = analysis;
  $('#feedback').onclick = () => window.open(CFG.feedback, '_blank', 'noopener,noreferrer');
  $('#restart').onclick = async () => { await window.vpdcStartNewAttempt?.(); };
}
window.finish = finish;

// Belt-and-braces autosave: covers Android/iOS browsers that don't reliably fire
// beforeunload, plus periodic safety saves during long sessions (Product Goal 4).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S.attempt) save('active'); });
window.addEventListener('pagehide', () => { try { if (S.attempt) window.vpdcPersistProgress?.('active'); } catch (e) {} });
window.addEventListener('beforeunload', () => { try { if (S.attempt) window.vpdcPersistProgress?.('active'); } catch (e) {} });
setInterval(() => { if (S.attempt) window.vpdcPersistProgress?.('active').catch(() => {}); }, 20000);

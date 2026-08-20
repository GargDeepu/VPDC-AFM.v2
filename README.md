# VPDC AFM

CA Final Paper 2 — Advanced Financial Management KBC-style practice app, by
VPDC — Vinijyn Pro Classes.

## What's in this version

- **Email + password login**, with sign-up collecting name, mobile number,
  city and email, verified by a one-time code sent to the student's email
  (no paid SMS provider needed).
- **Forgot / reset password**, same as any standard web app.
- Sessions persist in the browser automatically (Supabase's default), so a
  returning student is taken straight back into their quiz without logging in
  again, until they explicitly log out.
- Progress, answers, lifelines and a full per-question event trail keep
  auto-saving in the background (on every action, every 20 seconds, on tab
  hide, and on page close) so nothing is lost mid-session.
- Fixed VPDC logo: it's now a bundled local image (`assets/vpdc-logo.png`)
  instead of being fetched live from a GitHub raw URL on every repaint, which
  was the likely cause of the logo sometimes not showing.
- Mobile-responsive layout cleanup, merged into two CSS files
  (`final-fixes.css`, `visual-audit.css`) instead of duplicated/overlapping
  rules spread across several files.
- A single quiz-rendering implementation (`app.js` + `quiz-ui.css`). The
  previous codebase had **two** parallel UI implementations (one in `app.js`,
  one added on top in `vpdc-fixes.js`) with the second silently overriding the
  first at runtime — that duplication has been removed.
- `admin.html` — a lightweight admin dashboard (name, city, email, phone,
  last used, total time spent; see `SUPABASE_SETUP.md` for why passwords
  can't be shown, and what's shown instead).

## Files

- `index.html`, `app.js`, `auth.js` — the app itself.
- `styles.css`, `quiz-ui.css`, `final-fixes.css`, `visual-audit.css`,
  `auth.css` — styling.
- `render-hard-fix.js` — formats flattened case-scenario data tables.
- `admin.html`, `admin.js`, `admin.css` — the admin dashboard.
- `assets/` — logo and favicons.

## Required one-time setup

See `SUPABASE_SETUP.md` in the parent folder of this zip — you must run the
included SQL migration and flip a couple of Supabase dashboard switches
before this will work.

## Question bank

The app currently loads questions live from
`https://cadivyanshu.github.io/AFM/questions.js`. For full independence from
that external site, copy `questions.js` into this repo and update the
`<script src="...">` in `index.html` to point at your own copy.

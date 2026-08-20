# VPDC AFM — setup steps after this update

This update replaces the old "Google sign-in + SMS OTP" login with a simpler,
free-to-run **email + password + email OTP** login, adds a self-service
**forgot/reset password** flow, and adds an **admin dashboard**. It also fixes
the logo (was fetched live over the network from a GitHub raw URL on every
page repaint — fragile and the likely cause of the broken logo you saw) and
merges/cleans up the mobile CSS.

Everything below is a one-time setup in the Supabase dashboard. You do **not**
need Google Cloud Console anymore for this login flow (Google OAuth and SMS
phone OTP are no longer used by the new frontend, so you can leave those
provider toggles as-is or turn them off).

## 1. Run the SQL migration

Supabase Dashboard → your project (`qzsuqxgsnzmmzzwujhps`) → **SQL Editor** →
paste the full contents of `supabase_migration.sql` (included in this zip) →
Run. It only adds new columns/functions/tables; it does not delete anything.

## 2. Turn on Email provider (usually already on)

Dashboard → **Authentication → Providers → Email** → make sure it's enabled.
Turn **"Confirm email"** ON (this is what makes signup require OTP/verification
before the student can log in).

## 3. Make the signup confirmation email show a 6-digit code

By default Supabase's "Confirm signup" email contains a **link**, not a typed
code. To show a code the student types into the app:

Dashboard → **Authentication → Email Templates → Confirm signup** → edit the
template body so it displays `{{ .Token }}` (the 6-digit OTP) instead of
`{{ .ConfirmationURL }}`. Supabase's own docs have a ready-made "OTP" template
you can paste in — search "Supabase email OTP template" in their docs if the
default doesn't show a code.

If you skip this step, signup still works, but the email will contain a
"Confirm your email" link instead of a code — the app tells the student to
click that link instead, so nothing is broken, it's just less slick.

## 4. Password reset email

Dashboard → **Authentication → Email Templates → Reset password** — the
default link-based template works out of the box with this app, no changes
needed. The "Redirect URLs" allow-list (next step) must include your app URL
or the reset link will fail.

## 5. Add your app URL to Redirect URLs

Dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://gargdeepu.github.io/VPDC-AFM/`
- **Redirect URLs**: add `https://gargdeepu.github.io/VPDC-AFM/` (and
  `http://localhost:5500/` or similar if you test locally)

## 6. Create your admin account and authorise it

1. Open the deployed app, click **"Create a student account"**, and sign up
   with the email/password you want to use as the admin login. Verify it via
   the OTP/link like a normal student.
2. Dashboard → **Authentication → Users** → find that user → copy their
   **User UID**.
3. Dashboard → **SQL Editor** → run:
   ```sql
   insert into public.admin_users (auth_user_id, note)
   values ('paste-the-uuid-here', 'owner');
   ```
4. Open `admin.html` on your deployed site (e.g.
   `https://gargdeepu.github.io/VPDC-AFM/admin.html`) and log in with that
   same email/password.

You can add more admins later by repeating steps 1–3 for other accounts.

## 7. Rate limits / abuse protection (recommended, optional)

Dashboard → **Authentication → Rate Limits** — the defaults are fine to start;
tighten them before a large public launch to control OTP/reset email spam.

## What you no longer need to touch

- Google Cloud Console OAuth client — not used by the new flow.
- Any SMS/phone OTP provider — not used by the new flow (mobile number is now
  just a profile field collected at signup, shown to you in the admin panel;
  it is not used to log in and is not SMS-verified).

## Important limitation you should know about (admin panel, item 5(v))

You asked for the admin panel to show each student's **password**. This is
not something any properly built login system can do, including this one:
Supabase Auth (like virtually every password-based auth system) stores only a
one-way hash of the password, never the password itself, and there is no API
— admin or otherwise — that can recover it. The admin dashboard shows every
other field you asked for (name, city, email, phone, last used, total time
spent) and clearly labels the password column as "hidden — never stored" so
it's not left silently missing. If a student is locked out, they use "Forgot
password", or you can trigger a reset for them from Dashboard → Authentication
→ Users → (their row) → "Send password recovery".

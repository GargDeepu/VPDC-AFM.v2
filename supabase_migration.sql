-- ============================================================================
-- VPDC AFM — migration for email/password + email-OTP auth and the admin panel
-- ============================================================================
-- Run this in Supabase Dashboard → SQL Editor, on the qzsuqxgsnzmmzzwujhps project.
-- It is written to be additive and safe to re-run (IF NOT EXISTS / CREATE OR REPLACE),
-- but it assumes the students / quiz_attempts / attempt_sessions / attempt_answers /
-- answer_events tables described in VPDC_AFM_Claude_Handoff_Report.md already exist
-- with `id uuid primary key default gen_random_uuid()` style keys. If any column
-- below already exists with a different type, adjust that one line rather than
-- running the whole script blind.
-- ============================================================================

-- 1. Make sure `students` has everything the new auth model needs -----------
alter table public.students
  add column if not exists email text,
  add column if not exists auth_user_id uuid,
  add column if not exists auth_provider text default 'email',
  add column if not exists phone_verified boolean default false,
  add column if not exists last_active_at timestamptz,
  add column if not exists updated_at timestamptz default now();

-- The old flow required phone/name/place to be filled in immediately; the new
-- flow can briefly have a student row before those are filled in (e.g. a
-- re-verification relink), so make sure these aren't hard NOT NULL blockers.
alter table public.students alter column phone drop not null;
alter table public.students alter column name drop not null;
alter table public.students alter column place drop not null;

-- One student row per Supabase Auth user, one per email.
create unique index if not exists students_auth_user_id_key on public.students(auth_user_id) where auth_user_id is not null;
create unique index if not exists students_email_key on public.students(lower(email)) where email is not null;

-- ============================================================================
-- 2. Admin allow-list
-- ============================================================================
create table if not exists public.admin_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz default now()
);

-- After you sign up your own admin account through the normal Sign Up screen,
-- find your auth user id in Supabase Dashboard → Authentication → Users, then run:
--   insert into public.admin_users (auth_user_id, note) values ('<your-auth-user-uuid>', 'owner');
-- See SUPABASE_SETUP.md for the exact steps.

-- ============================================================================
-- 3. Row Level Security — students can only ever see their own row directly.
--    (RPCs below use SECURITY DEFINER to do the privileged work safely.)
-- ============================================================================
alter table public.students enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.attempt_sessions enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.answer_events enable row level security;

drop policy if exists students_self_select on public.students;
create policy students_self_select on public.students for select
  using (auth_user_id = auth.uid());

drop policy if exists quiz_attempts_self_select on public.quiz_attempts;
create policy quiz_attempts_self_select on public.quiz_attempts for select
  using (student_id in (select id from public.students where auth_user_id = auth.uid()));

drop policy if exists attempt_answers_self_select on public.attempt_answers;
create policy attempt_answers_self_select on public.attempt_answers for select
  using (attempt_id in (
    select qa.id from public.quiz_attempts qa
    join public.students s on s.id = qa.student_id
    where s.auth_user_id = auth.uid()
  ));

-- No direct insert/update/delete policies are defined on purpose: all writes
-- go through the SECURITY DEFINER RPCs below, which validate auth.uid() themselves.

-- ============================================================================
-- 4. link_authenticated_student — creates/updates the student's profile row
--    right after email OTP verification (or re-verification).
-- ============================================================================
create or replace function public.link_authenticated_student(
  p_name text, p_phone text, p_place text, p_email text
) returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students;
  v_phone_norm text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_phone_norm := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');

  insert into public.students (name, phone, place, email, auth_user_id, phone_normalized, auth_provider, phone_verified, created_at, last_active_at, updated_at)
  values (nullif(trim(p_name), ''), nullif(trim(p_phone), ''), nullif(trim(p_place), ''), lower(nullif(trim(p_email), '')), auth.uid(), nullif(v_phone_norm, ''), 'email', false, now(), now(), now())
  on conflict (auth_user_id) where auth_user_id is not null do update set
    name = coalesce(nullif(trim(excluded.name), ''), public.students.name),
    phone = coalesce(nullif(trim(excluded.phone), ''), public.students.phone),
    place = coalesce(nullif(trim(excluded.place), ''), public.students.place),
    email = coalesce(excluded.email, public.students.email),
    phone_normalized = coalesce(excluded.phone_normalized, public.students.phone_normalized),
    updated_at = now(),
    last_active_at = now()
  returning * into v_student;

  return v_student;
end;
$$;
revoke all on function public.link_authenticated_student(text, text, text, text) from public;
grant execute on function public.link_authenticated_student(text, text, text, text) to authenticated;

-- ============================================================================
-- 5. start_learning_session — resumes/creates the active attempt for this
--    student + quiz_key and opens a new attempt_sessions row.
-- ============================================================================
create or replace function public.start_learning_session(p_quiz_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students;
  v_attempt public.quiz_attempts;
  v_session public.attempt_sessions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_student from public.students where auth_user_id = auth.uid();
  if v_student.id is null then
    raise exception 'Student profile not found. Please complete sign up again.';
  end if;

  select * into v_attempt from public.quiz_attempts
    where student_id = v_student.id and quiz_key = p_quiz_key and status = 'active'
    order by started_at desc limit 1;

  if v_attempt.id is null then
    insert into public.quiz_attempts (student_id, quiz_key, status, current_question_index, total_seconds, started_at, last_saved_at)
    values (v_student.id, p_quiz_key, 'active', 0, 0, now(), now())
    returning * into v_attempt;
  end if;

  insert into public.attempt_sessions (attempt_id, student_id, auth_user_id, started_at, last_seen_at, user_agent)
  values (v_attempt.id, v_student.id, auth.uid(), now(), now(), current_setting('request.headers', true)::jsonb ->> 'user-agent')
  returning * into v_session;

  update public.students set last_active_at = now(), updated_at = now() where id = v_student.id;

  return jsonb_build_object('student', to_jsonb(v_student), 'attempt', to_jsonb(v_attempt), 'session', to_jsonb(v_session));
end;
$$;
revoke all on function public.start_learning_session(text) from public;
grant execute on function public.start_learning_session(text) to authenticated;

-- ============================================================================
-- 6. load_authenticated_attempt_answers
-- ============================================================================
create or replace function public.load_authenticated_attempt_answers(p_attempt_id uuid)
returns setof public.attempt_answers
language sql
security definer
set search_path = public
as $$
  select aa.* from public.attempt_answers aa
  join public.quiz_attempts qa on qa.id = aa.attempt_id
  join public.students s on s.id = qa.student_id
  where aa.attempt_id = p_attempt_id and s.auth_user_id = auth.uid();
$$;
revoke all on function public.load_authenticated_attempt_answers(uuid) from public;
grant execute on function public.load_authenticated_attempt_answers(uuid) to authenticated;

-- ============================================================================
-- 7. save_authenticated_answer — upserts the latest state for one question.
-- ============================================================================
create or replace function public.save_authenticated_answer(
  p_attempt_id uuid, p_question_id text, p_question_index int, p_selected_option int,
  p_correct_option int, p_is_correct boolean, p_skipped boolean, p_marked boolean,
  p_hidden_options int[], p_used_5050 boolean, p_used_expert boolean, p_used_poll boolean,
  p_seconds_spent int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.quiz_attempts qa join public.students s on s.id = qa.student_id
    where qa.id = p_attempt_id and s.auth_user_id = auth.uid()
  ) then
    raise exception 'Attempt does not belong to the authenticated student';
  end if;

  insert into public.attempt_answers (
    attempt_id, question_id, question_index, selected_option, correct_option, is_correct,
    skipped, marked_for_review, hidden_options, used_5050, used_expert, used_poll, seconds_spent, updated_at
  ) values (
    p_attempt_id, p_question_id, p_question_index, p_selected_option, p_correct_option, p_is_correct,
    coalesce(p_skipped,false), coalesce(p_marked,false), coalesce(p_hidden_options,'{}'), coalesce(p_used_5050,false),
    coalesce(p_used_expert,false), coalesce(p_used_poll,false), coalesce(p_seconds_spent,0), now()
  )
  on conflict (attempt_id, question_id) do update set
    question_index = excluded.question_index, selected_option = excluded.selected_option,
    correct_option = excluded.correct_option, is_correct = excluded.is_correct,
    skipped = excluded.skipped, marked_for_review = excluded.marked_for_review,
    hidden_options = excluded.hidden_options, used_5050 = excluded.used_5050,
    used_expert = excluded.used_expert, used_poll = excluded.used_poll,
    seconds_spent = excluded.seconds_spent, updated_at = now();

  update public.students set last_active_at = now() where auth_user_id = auth.uid();
end;
$$;
revoke all on function public.save_authenticated_answer(uuid,text,int,int,int,boolean,boolean,boolean,int[],boolean,boolean,boolean,int) from public;
grant execute on function public.save_authenticated_answer(uuid,text,int,int,int,boolean,boolean,boolean,int[],boolean,boolean,boolean,int) to authenticated;

-- Requires a uniqueness guarantee for the upsert above:
create unique index if not exists attempt_answers_attempt_question_key on public.attempt_answers(attempt_id, question_id);

-- ============================================================================
-- 8. save_authenticated_progress — current position + running total time.
-- ============================================================================
create or replace function public.save_authenticated_progress(
  p_attempt_id uuid, p_current_index int, p_current_question_id text, p_total_seconds int, p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quiz_attempts qa set
    current_question_index = p_current_index,
    current_question_id = p_current_question_id,
    total_seconds = p_total_seconds,
    status = coalesce(p_status, qa.status),
    last_saved_at = now(),
    completed_at = case when p_status = 'completed' then now() else qa.completed_at end
  from public.students s
  where qa.id = p_attempt_id and s.id = qa.student_id and s.auth_user_id = auth.uid();

  update public.students set last_active_at = now() where auth_user_id = auth.uid();

  update public.attempt_sessions set last_seen_at = now()
  where attempt_id = p_attempt_id and auth_user_id = auth.uid() and ended_at is null;
end;
$$;
revoke all on function public.save_authenticated_progress(uuid,int,text,int,text) from public;
grant execute on function public.save_authenticated_progress(uuid,int,text,int,text) to authenticated;

-- ============================================================================
-- 9. record_answer_event — append-only activity trail.
-- ============================================================================
create or replace function public.record_answer_event(
  p_session_id uuid, p_attempt_id uuid, p_question_id text, p_question_index int, p_event_type text,
  p_selected_option int, p_is_correct boolean, p_skipped boolean, p_marked_for_review boolean,
  p_hidden_options int[], p_used_5050 boolean, p_used_expert boolean, p_used_poll boolean, p_seconds_spent int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  select s.id into v_student_id from public.students s where s.auth_user_id = auth.uid();
  if v_student_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.answer_events (
    session_id, attempt_id, student_id, question_id, question_index, event_type,
    selected_option, is_correct, skipped, marked_for_review, hidden_options,
    used_5050, used_expert, used_poll, seconds_spent, created_at
  ) values (
    p_session_id, p_attempt_id, v_student_id, p_question_id, p_question_index, p_event_type,
    p_selected_option, p_is_correct, coalesce(p_skipped,false), coalesce(p_marked_for_review,false), coalesce(p_hidden_options,'{}'),
    coalesce(p_used_5050,false), coalesce(p_used_expert,false), coalesce(p_used_poll,false), coalesce(p_seconds_spent,0), now()
  );
end;
$$;
revoke all on function public.record_answer_event(uuid,uuid,text,int,text,int,boolean,boolean,boolean,int[],boolean,boolean,boolean,int) from public;
grant execute on function public.record_answer_event(uuid,uuid,text,int,text,int,boolean,boolean,boolean,int[],boolean,boolean,boolean,int) to authenticated;

-- ============================================================================
-- 10. start_new_attempt_authenticated — archives the finished attempt and
--     opens a fresh one (used by the "Start Again" button).
-- ============================================================================
create or replace function public.start_new_attempt_authenticated(p_quiz_key text)
returns public.quiz_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_attempt public.quiz_attempts;
begin
  select id into v_student_id from public.students where auth_user_id = auth.uid();
  if v_student_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.quiz_attempts set status = 'archived'
  where student_id = v_student_id and quiz_key = p_quiz_key and status = 'active';

  insert into public.quiz_attempts (student_id, quiz_key, status, current_question_index, total_seconds, started_at, last_saved_at)
  values (v_student_id, p_quiz_key, 'active', 0, 0, now(), now())
  returning * into v_attempt;

  return v_attempt;
end;
$$;
revoke all on function public.start_new_attempt_authenticated(text) from public;
grant execute on function public.start_new_attempt_authenticated(text) to authenticated;

-- ============================================================================
-- 11. Admin overview — aggregated, read-only, and gated by admin_users.
-- ============================================================================
create or replace view public.admin_student_overview as
select
  s.id,
  s.name,
  s.place,
  s.email,
  s.phone,
  s.last_active_at,
  s.created_at,
  coalesce((select sum(qa.total_seconds) from public.quiz_attempts qa where qa.student_id = s.id), 0) as total_seconds
from public.students s;

create or replace function public.admin_list_students()
returns setof public.admin_student_overview
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_users a where a.auth_user_id = auth.uid()) then
    raise exception 'Not authorised';
  end if;
  return query select * from public.admin_student_overview order by last_active_at desc nulls last;
end;
$$;
revoke all on function public.admin_list_students() from public;
grant execute on function public.admin_list_students() to authenticated;

-- ============================================================================
-- 12. Legacy phone-only / Google+SMS RPCs from earlier iterations
--     (register_or_resume_student, resume_attempt, save_attempt_answer,
--      save_attempt_progress, start_new_attempt, link the old phone-OTP
--      version of link_authenticated_student, load_attempt_answers) are
--     intentionally left untouched by this script. They are no longer
--     called by the new frontend. You can drop them once you've confirmed
--     the new email/password flow is fully working in production, e.g.:
--       drop function if exists public.register_or_resume_student(text, text, text);
--       drop function if exists public.resume_attempt(text, text);
--     Do this only after verifying nothing else depends on them.
-- ============================================================================

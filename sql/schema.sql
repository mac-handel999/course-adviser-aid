-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).
-- Safe to re-run against an existing project — all statements are idempotent.

create extension if not exists pgcrypto;

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  year text not null,
  semester text not null,
  reg_no text,
  student_name text,
  course_code text,
  course_title text,
  credit_unit numeric,
  score numeric,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Preserve results even if the owning adviser's account is later deleted
-- (e.g. resignation, handoff to a new adviser) rather than losing the data.
alter table public.results drop constraint if exists results_created_by_fkey;
alter table public.results
  add constraint results_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.results enable row level security;

-- Results are private per-user (per course adviser).
-- Primary enforcement is in the Express API routes (server/routes/results.js),
-- because the API uses the Supabase service role key which bypasses RLS.
-- These RLS policies are a secondary safeguard in case the anon key is ever
-- used to query this table directly, bypassing the API.

drop policy if exists "Authenticated users can read results" on public.results;
drop policy if exists "Authenticated users can insert results" on public.results;
drop policy if exists "Authenticated users can update results" on public.results;
drop policy if exists "Authenticated users can delete results" on public.results;

create policy "Authenticated users can read results"
  on public.results for select
  to authenticated
  using (created_by = auth.uid());

create policy "Authenticated users can insert results"
  on public.results for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Authenticated users can update results"
  on public.results for update
  to authenticated
  using (created_by = auth.uid());

create policy "Authenticated users can delete results"
  on public.results for delete
  to authenticated
  using (created_by = auth.uid());

-- Keep updated_at current on every edit.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql
set search_path = public;

drop trigger if exists results_set_updated_at on public.results;
create trigger results_set_updated_at
  before update on public.results
  for each row execute function public.set_updated_at();

-- Adviser-specific settings for the public student portal.
create table if not exists public.adviser_settings (
  user_id uuid primary key references auth.users(id),
  portal_slug text unique not null,
  passcode_hash text,
  faculty text default 'SCHOOL OF HEALTH TECHNOLOGY (SOHT)',
  department text default 'DEPARTMENT OF PUBLIC HEALTH',
  class_set text,
  updated_at timestamptz default now()
);

-- Config data belongs solely to its adviser — clean it up if the account goes.
alter table public.adviser_settings drop constraint if exists adviser_settings_user_id_fkey;
alter table public.adviser_settings
  add constraint adviser_settings_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.adviser_settings enable row level security;

-- Primary enforcement is in the Express API routes (server/routes/settings.js),
-- because the API uses the Supabase service role key which bypasses RLS.
-- These RLS policies are a secondary safeguard in case the anon key is ever
-- used to query this table directly, bypassing the API.

drop policy if exists "Authenticated users can read own settings" on public.adviser_settings;
drop policy if exists "Authenticated users can insert own settings" on public.adviser_settings;
drop policy if exists "Authenticated users can update own settings" on public.adviser_settings;
drop policy if exists "Authenticated users can delete own settings" on public.adviser_settings;

create policy "Authenticated users can read own settings"
  on public.adviser_settings for select
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can insert own settings"
  on public.adviser_settings for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Authenticated users can update own settings"
  on public.adviser_settings for update
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can delete own settings"
  on public.adviser_settings for delete
  to authenticated
  using (user_id = auth.uid());

drop trigger if exists adviser_settings_set_updated_at on public.adviser_settings;
create trigger adviser_settings_set_updated_at
  before update on public.adviser_settings
  for each row execute function public.set_updated_at();

-- Per-year, per-semester credit load targets for completeness tracking.
create table if not exists public.credit_load_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year text not null,
  semester text not null,
  total_units numeric not null check (total_units > 0),
  updated_at timestamptz default now(),
  unique (user_id, year, semester)
);

alter table public.credit_load_settings enable row level security;

-- Primary enforcement is in the Express API routes (server/routes/creditLoad.js),
-- because the API uses the Supabase service role key which bypasses RLS.
-- These RLS policies are a secondary safeguard in case the anon key is ever
-- used to query this table directly, bypassing the API.

drop policy if exists "Authenticated users can read own credit load" on public.credit_load_settings;
drop policy if exists "Authenticated users can insert own credit load" on public.credit_load_settings;
drop policy if exists "Authenticated users can update own credit load" on public.credit_load_settings;
drop policy if exists "Authenticated users can delete own credit load" on public.credit_load_settings;

create policy "Authenticated users can read own credit load"
  on public.credit_load_settings for select
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can insert own credit load"
  on public.credit_load_settings for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Authenticated users can update own credit load"
  on public.credit_load_settings for update
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can delete own credit load"
  on public.credit_load_settings for delete
  to authenticated
  using (user_id = auth.uid());

drop trigger if exists credit_load_settings_set_updated_at on public.credit_load_settings;
create trigger credit_load_settings_set_updated_at
  before update on public.credit_load_settings
  for each row execute function public.set_updated_at();

-- Carry-over retake flag for results.
alter table public.results add column if not exists is_carryover boolean default false;

-- Score range constraint: 0-100 or null.
alter table public.results drop constraint if exists results_score_range;
alter table public.results
  add constraint results_score_range
  check (score is null or (score >= 0 and score <= 100));

-- Per-year academic session labels (e.g. "2025/2026").
create table if not exists public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year text not null,
  session_label text not null,
  is_auto boolean not null default true,
  updated_at timestamptz default now(),
  unique (user_id, year)
);

alter table public.academic_sessions enable row level security;

-- Primary enforcement is in the Express API routes (server/routes/academicSessions.js),
-- because the API uses the Supabase service role key which bypasses RLS.
-- These RLS policies are a secondary safeguard in case the anon key is ever
-- used to query this table directly, bypassing the API.

drop policy if exists "Authenticated users can read own academic sessions" on public.academic_sessions;
drop policy if exists "Authenticated users can insert own academic sessions" on public.academic_sessions;
drop policy if exists "Authenticated users can update own academic sessions" on public.academic_sessions;
drop policy if exists "Authenticated users can delete own academic sessions" on public.academic_sessions;

create policy "Authenticated users can read own academic sessions"
  on public.academic_sessions for select
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can insert own academic sessions"
  on public.academic_sessions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Authenticated users can update own academic sessions"
  on public.academic_sessions for update
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can delete own academic sessions"
  on public.academic_sessions for delete
  to authenticated
  using (user_id = auth.uid());

drop trigger if exists academic_sessions_set_updated_at on public.academic_sessions;
create trigger academic_sessions_set_updated_at
  before update on public.academic_sessions
  for each row execute function public.set_updated_at();

-- Per-course records for result entry.  The results table keeps its
-- course_code / course_title / credit_unit columns as a denormalized
-- copy on every row (useful for historical audit and so nothing breaks
-- that reads row.course_code directly).  The courses table is the new
-- source of truth for course metadata; results rows link to it via
-- course_id (nullable so existing rows are not broken before backfill).
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year text not null,
  semester text not null,
  course_code text not null,
  course_title text,
  credit_unit numeric,
  created_at timestamptz default now(),
  unique (user_id, year, semester, course_code)
);

alter table public.courses enable row level security;

-- Primary enforcement is in the Express API routes (server/routes/courses.js),
-- because the API uses the Supabase service role key which bypasses RLS.
-- These RLS policies are a secondary safeguard in case the anon key is ever
-- used to query this table directly, bypassing the API.

drop policy if exists "Authenticated users can read own courses" on public.courses;
drop policy if exists "Authenticated users can insert own courses" on public.courses;
drop policy if exists "Authenticated users can update own courses" on public.courses;
drop policy if exists "Authenticated users can delete own courses" on public.courses;

create policy "Authenticated users can read own courses"
  on public.courses for select
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can insert own courses"
  on public.courses for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Authenticated users can update own courses"
  on public.courses for update
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can delete own courses"
  on public.courses for delete
  to authenticated
  using (user_id = auth.uid());

-- Unique constraint on (course_id, reg_no) prevents duplicate student
-- entries within the same course.  Added after the migration scripts
-- have verified no existing violations exist.  The constraint name
-- follows the snake_case convention used elsewhere in this schema.
-- NOTE: Apply this constraint AFTER running scripts/migrate-courses.js
-- and verifying no (course_id, reg_no) duplicates exist in your data.
-- If any violations are found, resolve them in the SQL editor before
-- adding this constraint.
alter table public.results add column if not exists course_id uuid references public.courses(id) on delete set null;

-- Add a unique constraint on (course_id, reg_no) to prevent duplicate
-- student entries within the same course.  Verifies no violations exist
-- first — if any are found, the DO block raises an exception (not silent)
-- so the adviser can resolve them before re-running.
do $$
declare
  dup_count int;
begin
  select count(*) into dup_count
  from (
    select 1 from public.results
    where course_id is not null and reg_no is not null
    group by course_id, reg_no
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    raise exception 'Found % duplicate (course_id, reg_no) pair(s) in results. Resolve these before adding the unique constraint.', dup_count;
  else
    alter table public.results drop constraint if exists results_course_reg_unique;
    alter table public.results add constraint results_course_reg_unique unique (course_id, reg_no);
  end if;
end $$;
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).

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
  updated_at timestamptz default now()
);

alter table public.adviser_settings enable row level security;

-- Primary enforcement is in the Express API routes (server/routes/settings.js),
-- because the API uses the Supabase service role key which bypasses RLS.
-- These RLS policies are a secondary safeguard in case the anon key is ever
-- used to query this table directly, bypassing the API.

drop policy if exists "Authenticated users can read own settings" on public.adviser_settings;
drop policy if exists "Authenticated users can update own settings" on public.adviser_settings;

create policy "Authenticated users can read own settings"
  on public.adviser_settings for select
  to authenticated
  using (user_id = auth.uid());

create policy "Authenticated users can update own settings"
  on public.adviser_settings for update
  to authenticated
  using (user_id = auth.uid());

drop trigger if exists adviser_settings_set_updated_at on public.adviser_settings;
create trigger adviser_settings_set_updated_at
  before update on public.adviser_settings
  for each row execute function public.set_updated_at();

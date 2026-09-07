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

-- This treats the portal as one shared department workspace: any signed-in
-- staff account can read and edit every row, which matches how the old
-- shared spreadsheet worked. Tighten these to `created_by = auth.uid()`
-- later if you need each account to only see its own entries.

drop policy if exists "Authenticated users can read results" on public.results;
drop policy if exists "Authenticated users can insert results" on public.results;
drop policy if exists "Authenticated users can update results" on public.results;
drop policy if exists "Authenticated users can delete results" on public.results;

create policy "Authenticated users can read results"
  on public.results for select
  to authenticated
  using (true);

create policy "Authenticated users can insert results"
  on public.results for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update results"
  on public.results for update
  to authenticated
  using (true);

create policy "Authenticated users can delete results"
  on public.results for delete
  to authenticated
  using (true);

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

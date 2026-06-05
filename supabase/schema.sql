create extension if not exists pgcrypto;

create table if not exists public.study_entries (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  discord_user_id text,
  username text not null,
  minutes integer not null check (minutes >= 1 and minutes <= 1440),
  study_date date not null,
  source text not null default 'dashboard',
  channel_id text,
  message_id text,
  created_at timestamptz not null default now()
);

create index if not exists study_entries_study_date_idx
  on public.study_entries (study_date desc);

create index if not exists study_entries_auth_user_id_idx
  on public.study_entries (auth_user_id);

create index if not exists study_entries_discord_user_id_idx
  on public.study_entries (discord_user_id);

alter table public.study_entries enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, delete on public.study_entries to authenticated;
grant all on public.study_entries to service_role;

drop policy if exists "authenticated users can read study entries" on public.study_entries;
create policy "authenticated users can read study entries"
  on public.study_entries
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated users can insert own dashboard entries" on public.study_entries;
create policy "authenticated users can insert own dashboard entries"
  on public.study_entries
  for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and discord_user_id is null
    and source in ('dashboard', 'dashboard-import')
  );

drop policy if exists "authenticated users can delete own dashboard entries" on public.study_entries;
create policy "authenticated users can delete own dashboard entries"
  on public.study_entries
  for delete
  to authenticated
  using (
    auth_user_id = auth.uid()
    and source in ('dashboard', 'dashboard-import')
  );

create table if not exists public.study_user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  discord_user_id text unique,
  username text not null,
  goal_minutes integer not null default 120 check (goal_minutes >= 1 and goal_minutes <= 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_user_profiles_auth_user_id_idx
  on public.study_user_profiles (auth_user_id);

create index if not exists study_user_profiles_discord_user_id_idx
  on public.study_user_profiles (discord_user_id);

alter table public.study_user_profiles enable row level security;

grant select, insert, update on public.study_user_profiles to authenticated;
grant all on public.study_user_profiles to service_role;

drop policy if exists "authenticated users can read profiles" on public.study_user_profiles;
create policy "authenticated users can read profiles"
  on public.study_user_profiles
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated users can insert own profile" on public.study_user_profiles;
create policy "authenticated users can insert own profile"
  on public.study_user_profiles
  for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and discord_user_id is null
  );

drop policy if exists "authenticated users can update own profile" on public.study_user_profiles;
create policy "authenticated users can update own profile"
  on public.study_user_profiles
  for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (
    auth_user_id = auth.uid()
    and discord_user_id is null
  );

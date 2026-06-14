create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.study_entries (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  discord_user_id text,
  google_email citext,
  username text not null,
  minutes integer not null check (minutes >= 1 and minutes <= 1440),
  study_date date not null,
  source text not null default 'dashboard',
  channel_id text,
  message_id text,
  created_at timestamptz not null default now()
);

alter table public.study_entries
  add column if not exists google_email citext;

update public.study_entries
  set google_email = lower(username)::citext
  where google_email is null and username like '%@%';

alter table public.study_entries
  alter column google_email set not null;

create index if not exists study_entries_study_date_idx
  on public.study_entries (study_date desc);

create index if not exists study_entries_auth_user_id_idx
  on public.study_entries (auth_user_id);

create index if not exists study_entries_discord_user_id_idx
  on public.study_entries (discord_user_id);

create index if not exists study_entries_google_email_idx
  on public.study_entries (google_email);

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
    and google_email = lower(auth.jwt() ->> 'email')::citext
    and source in ('dashboard', 'dashboard-import')
  );

drop policy if exists "authenticated users can delete own dashboard entries" on public.study_entries;
create policy "authenticated users can delete own dashboard entries"
  on public.study_entries
  for delete
  to authenticated
  using (
    auth_user_id = auth.uid()
    and google_email = lower(auth.jwt() ->> 'email')::citext
    and source in ('dashboard', 'dashboard-import')
  );

create table if not exists public.study_user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  discord_user_id text unique,
  google_email citext unique,
  username text not null,
  goal_minutes integer not null default 120 check (goal_minutes >= 1 and goal_minutes <= 1440),
  weekly_goal_minutes jsonb not null default '{"0":120,"1":120,"2":120,"3":120,"4":120,"5":120,"6":120}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.study_user_profiles
  add column if not exists google_email citext unique,
  add column if not exists weekly_goal_minutes jsonb not null default '{"0":120,"1":120,"2":120,"3":120,"4":120,"5":120,"6":120}'::jsonb;

update public.study_user_profiles
  set google_email = lower(username)::citext
  where google_email is null and username like '%@%';

create index if not exists study_user_profiles_auth_user_id_idx
  on public.study_user_profiles (auth_user_id);

create index if not exists study_user_profiles_discord_user_id_idx
  on public.study_user_profiles (discord_user_id);

create index if not exists study_user_profiles_google_email_idx
  on public.study_user_profiles (google_email);

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
    and google_email = lower(auth.jwt() ->> 'email')::citext
  );

drop policy if exists "authenticated users can update own profile" on public.study_user_profiles;
create policy "authenticated users can update own profile"
  on public.study_user_profiles
  for update
  to authenticated
  using (
    (auth_user_id = auth.uid() or auth_user_id is null)
    and google_email = lower(auth.jwt() ->> 'email')::citext
  )
  with check (
    auth_user_id = auth.uid()
    and google_email = lower(auth.jwt() ->> 'email')::citext
  );

create table if not exists public.study_quality_ratings (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  discord_user_id text,
  google_email citext not null,
  username text not null,
  study_date date not null,
  score integer not null check (score >= 1 and score <= 5),
  note text,
  source text not null default 'dashboard',
  created_at timestamptz not null default now()
);

create index if not exists study_quality_ratings_study_date_idx
  on public.study_quality_ratings (study_date desc);

create index if not exists study_quality_ratings_google_email_idx
  on public.study_quality_ratings (google_email);

alter table public.study_quality_ratings enable row level security;

grant select, insert, delete on public.study_quality_ratings to authenticated;
grant all on public.study_quality_ratings to service_role;

drop policy if exists "authenticated users can read quality ratings" on public.study_quality_ratings;
create policy "authenticated users can read quality ratings"
  on public.study_quality_ratings
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated users can insert own quality ratings" on public.study_quality_ratings;
create policy "authenticated users can insert own quality ratings"
  on public.study_quality_ratings
  for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and google_email = lower(auth.jwt() ->> 'email')::citext
    and source in ('dashboard', 'dashboard-import')
  );

drop policy if exists "authenticated users can delete own quality ratings" on public.study_quality_ratings;
create policy "authenticated users can delete own quality ratings"
  on public.study_quality_ratings
  for delete
  to authenticated
  using (
    auth_user_id = auth.uid()
    and google_email = lower(auth.jwt() ->> 'email')::citext
    and source in ('dashboard', 'dashboard-import')
  );

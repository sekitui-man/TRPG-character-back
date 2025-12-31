create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key,
  name text,
  tagline text,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles select own"
on profiles for select
using (id = auth.uid());

create policy "profiles insert own"
on profiles for insert
with check (id = auth.uid());

create policy "profiles update own"
on profiles for update
using (id = auth.uid());

create table if not exists session_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table session_logs enable row level security;

create policy "session_logs select for participants"
on session_logs for select
using (
  exists (
    select 1 from session_participants
    where session_participants.session_id = session_logs.session_id
      and session_participants.user_id = auth.uid()
  )
);

create policy "session_logs insert for participants"
on session_logs for insert
with check (
  exists (
    select 1 from session_participants
    where session_participants.session_id = session_logs.session_id
      and session_participants.user_id = auth.uid()
  )
);

create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text,
  url text not null,
  created_at timestamptz not null default now()
);

alter table uploads enable row level security;

create policy "uploads select own"
on uploads for select
using (user_id = auth.uid());

create policy "uploads insert own"
on uploads for insert
with check (user_id = auth.uid());

create policy "participants select for session members"
on session_participants for select
using (
  exists (
    select 1 from session_participants sp
    where sp.session_id = session_participants.session_id
      and sp.user_id = auth.uid()
  )
);

insert into app_migrations (id)
values ('20241015_add_mock_api_tables')
on conflict (id) do nothing;

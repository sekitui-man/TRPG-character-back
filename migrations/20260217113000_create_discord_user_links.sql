create table if not exists discord_user_links (
  discord_user_id text primary key,
  user_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table discord_user_links enable row level security;

create policy "discord links select own"
on discord_user_links for select
using (user_id = auth.uid());

create policy "discord links insert own"
on discord_user_links for insert
with check (user_id = auth.uid());

create policy "discord links update own"
on discord_user_links for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "discord links delete own"
on discord_user_links for delete
using (user_id = auth.uid());

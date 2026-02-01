create table if not exists character_sheets_coc6 (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  user_id uuid not null,
  data jsonb not null default '{}'::jsonb,
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (character_id)
);

alter table character_sheets_coc6 enable row level security;

create policy "coc6 sheets select own or public"
on character_sheets_coc6 for select
using (user_id = auth.uid() or visibility = 'public');

create policy "coc6 sheets insert own"
on character_sheets_coc6 for insert
with check (user_id = auth.uid());

create policy "coc6 sheets update own"
on character_sheets_coc6 for update
using (user_id = auth.uid());

create policy "coc6 sheets delete own"
on character_sheets_coc6 for delete
using (user_id = auth.uid());

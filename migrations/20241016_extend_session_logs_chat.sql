create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table session_logs
  add column if not exists message_type text not null default 'chat',
  add column if not exists speaker_type text not null default 'account',
  add column if not exists speaker_name text,
  add column if not exists speaker_color text,
  add column if not exists message_font text,
  add column if not exists dice_result jsonb;

insert into app_migrations (id)
values ('20241016_extend_session_logs_chat')
on conflict (id) do nothing;

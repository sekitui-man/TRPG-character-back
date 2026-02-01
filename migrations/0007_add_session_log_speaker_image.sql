create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table if exists session_logs
  add column if not exists speaker_image_url text;

insert into app_migrations (id)
values ('0007_add_session_log_speaker_image')
on conflict (id) do nothing;

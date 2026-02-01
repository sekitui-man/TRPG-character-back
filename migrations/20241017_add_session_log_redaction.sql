create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table session_logs
  add column if not exists redacted_for_id uuid references session_logs(id) on delete cascade;

insert into app_migrations (id)
values ('20241017_add_session_log_redaction')
on conflict (id) do nothing;

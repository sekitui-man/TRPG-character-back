create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

insert into app_migrations (id)
values ('20241015_create_migration_history')
on conflict (id) do nothing;

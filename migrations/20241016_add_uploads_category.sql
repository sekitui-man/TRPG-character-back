create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table uploads
  add column if not exists category text not null default 'misc';

insert into app_migrations (id)
values ('20241016_add_uploads_category')
on conflict (id) do nothing;

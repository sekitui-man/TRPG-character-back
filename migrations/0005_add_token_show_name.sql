create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table if exists tokens
  add column if not exists show_name boolean not null default false;

insert into app_migrations (id)
values ('0005_add_token_show_name')
on conflict (id) do nothing;

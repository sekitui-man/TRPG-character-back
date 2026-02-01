create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table if exists chat_tabs
  add column if not exists toast_enabled boolean not null default true;

insert into app_migrations (id)
values ('0006_add_chat_tab_toast_setting')
on conflict (id) do nothing;

create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table if exists boards
  add column if not exists grid_enabled boolean not null default true,
  add column if not exists grid_background_color text;

insert into app_migrations (id)
values ('0002_add_board_grid_settings')
on conflict (id) do nothing;

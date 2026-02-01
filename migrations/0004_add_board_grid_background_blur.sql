create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table if exists boards
  add column if not exists grid_background_blur boolean not null default false;

insert into app_migrations (id)
values ('0004_add_board_grid_background_blur')
on conflict (id) do nothing;

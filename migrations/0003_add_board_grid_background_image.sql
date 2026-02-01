create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table if exists boards
  add column if not exists grid_background_image_url text;

insert into app_migrations (id)
values ('0003_add_board_grid_background_image')
on conflict (id) do nothing;

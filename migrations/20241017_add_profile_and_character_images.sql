create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table profiles
  add column if not exists avatar_url text;

alter table characters
  add column if not exists image_url text;

insert into app_migrations (id)
values ('20241017_add_profile_and_character_images')
on conflict (id) do nothing;

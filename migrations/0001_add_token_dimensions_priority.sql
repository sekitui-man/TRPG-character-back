create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table if exists tokens
  add column if not exists width integer not null default 64,
  add column if not exists height integer not null default 64,
  add column if not exists priority integer not null default 0;

do $$
begin
  if to_regclass('public.tokens') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'tokens_width_positive_check'
    ) then
      alter table public.tokens
        add constraint tokens_width_positive_check
        check (width > 0);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'tokens_height_positive_check'
    ) then
      alter table public.tokens
        add constraint tokens_height_positive_check
        check (height > 0);
    end if;
  end if;
end $$;

insert into app_migrations (id)
values ('0001_add_token_dimensions_priority')
on conflict (id) do nothing;

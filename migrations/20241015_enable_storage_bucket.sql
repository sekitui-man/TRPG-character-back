create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('trpg-assets', 'trpg-assets', true)
on conflict (id) do nothing;

drop policy if exists "storage trpg-assets select" on storage.objects;
drop policy if exists "storage trpg-assets insert" on storage.objects;

create policy "storage trpg-assets select"
on storage.objects for select
using (bucket_id = 'trpg-assets');

create policy "storage trpg-assets insert"
on storage.objects for insert
with check (bucket_id = 'trpg-assets' and auth.uid() = owner);

insert into app_migrations (id)
values ('20241015_enable_storage_bucket')
on conflict (id) do nothing;

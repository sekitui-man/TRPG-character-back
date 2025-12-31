create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists chat_tabs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  allowed_roles text[],
  allowed_users uuid[],
  is_default boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists chat_tabs_default_unique
on chat_tabs (session_id)
where is_default;

alter table chat_tabs enable row level security;

drop policy if exists "chat tabs select for session members" on chat_tabs;
drop policy if exists "chat tabs insert owner" on chat_tabs;
drop policy if exists "chat tabs update owner" on chat_tabs;
drop policy if exists "chat tabs delete owner" on chat_tabs;

create policy "chat tabs select for session members"
on chat_tabs for select
using (
  exists (
    select 1 from session_participants sp
    where sp.session_id = chat_tabs.session_id
      and sp.user_id = auth.uid()
  )
  and (
    (coalesce(array_length(chat_tabs.allowed_roles, 1), 0) = 0
      and coalesce(array_length(chat_tabs.allowed_users, 1), 0) = 0)
    or auth.uid() = any(chat_tabs.allowed_users)
    or exists (
      select 1 from session_participants sp
      where sp.session_id = chat_tabs.session_id
        and sp.user_id = auth.uid()
        and sp.role = any(chat_tabs.allowed_roles)
    )
  )
);

create policy "chat tabs insert owner"
on chat_tabs for insert
with check (
  exists (
    select 1 from session_participants sp
    where sp.session_id = chat_tabs.session_id
      and sp.user_id = auth.uid()
      and sp.role = 'owner'
  )
);

create policy "chat tabs update owner"
on chat_tabs for update
using (
  exists (
    select 1 from session_participants sp
    where sp.session_id = chat_tabs.session_id
      and sp.user_id = auth.uid()
      and sp.role = 'owner'
  )
)
with check (
  exists (
    select 1 from session_participants sp
    where sp.session_id = chat_tabs.session_id
      and sp.user_id = auth.uid()
      and sp.role = 'owner'
  )
);

create policy "chat tabs delete owner"
on chat_tabs for delete
using (
  exists (
    select 1 from session_participants sp
    where sp.session_id = chat_tabs.session_id
      and sp.user_id = auth.uid()
      and sp.role = 'owner'
  )
);

create or replace function can_view_chat_tab(p_tab_id uuid, p_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from session_participants sp
    where sp.session_id = p_session_id
      and sp.user_id = auth.uid()
  )
  and (
    p_tab_id is null
    or exists (
      select 1 from chat_tabs ct
      where ct.id = p_tab_id
        and ct.session_id = p_session_id
        and (
          (coalesce(array_length(ct.allowed_roles, 1), 0) = 0
            and coalesce(array_length(ct.allowed_users, 1), 0) = 0)
          or auth.uid() = any(ct.allowed_users)
          or exists (
            select 1 from session_participants sp
            where sp.session_id = ct.session_id
              and sp.user_id = auth.uid()
              and sp.role = any(ct.allowed_roles)
          )
        )
    )
  );
$$;

alter table session_logs
  add column if not exists tab_id uuid references chat_tabs(id) on delete set null;

drop policy if exists "session_logs select for participants" on session_logs;
drop policy if exists "session_logs insert for participants" on session_logs;

create policy "session_logs select for allowed tabs"
on session_logs for select
using (can_view_chat_tab(tab_id, session_id));

create policy "session_logs insert for allowed tabs"
on session_logs for insert
with check (can_view_chat_tab(tab_id, session_id));

insert into chat_tabs (id, session_id, name, allowed_roles, allowed_users, is_default, created_by)
select
  gen_random_uuid(),
  s.id,
  '全体',
  null,
  null,
  true,
  (
    select sp.user_id
    from session_participants sp
    where sp.session_id = s.id
      and sp.role = 'owner'
    limit 1
  )
from sessions s
where not exists (
  select 1 from chat_tabs ct
  where ct.session_id = s.id
);

update session_logs sl
set tab_id = ct.id
from chat_tabs ct
where sl.tab_id is null
  and ct.session_id = sl.session_id
  and ct.is_default = true;

insert into app_migrations (id)
values ('20241016_add_chat_tabs')
on conflict (id) do nothing;

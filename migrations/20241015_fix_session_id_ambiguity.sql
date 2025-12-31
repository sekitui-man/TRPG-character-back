create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create or replace function is_session_member(session_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from session_participants sp
    where sp.session_id = $1
      and sp.user_id = auth.uid()
  );
$$;

drop function if exists join_session_with_token(uuid, text);

create or replace function join_session_with_token(
  session_id uuid,
  join_token text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visibility text;
  v_join_token text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select visibility, sessions.join_token
    into v_visibility, v_join_token
  from sessions
  where id = $1;

  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if v_visibility = 'private' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_visibility = 'link' then
    if $2 is null or $2 = '' or $2 <> v_join_token then
      raise exception 'invalid token' using errcode = '42501';
    end if;
  end if;

  insert into session_participants (id, session_id, user_id, role, created_at)
  values (gen_random_uuid(), $1, auth.uid(), 'participant', now())
  on conflict (session_id, user_id) do nothing;
end;
$$;

insert into app_migrations (id)
values ('20241015_fix_session_id_ambiguity')
on conflict (id) do nothing;

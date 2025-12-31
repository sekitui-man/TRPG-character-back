create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

drop policy if exists "participants select for session members" on public.session_participants;

do $$
declare
  rec record;
begin
  for rec in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_session_member', 'join_session_with_token')
  loop
    execute format('drop function if exists %I.%I(%s) cascade;', rec.nspname, rec.proname, rec.args);
  end loop;
end $$;

create or replace function public.is_session_member(p_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.session_participants sp
    where sp.session_id = p_session_id
      and sp.user_id = auth.uid()
  );
$$;

create or replace function public.join_session_with_token(
  session_id uuid,
  join_token text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_session_id alias for $1;
  p_join_token alias for $2;
  v_visibility text;
  v_join_token text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select visibility, sessions.join_token
    into v_visibility, v_join_token
  from public.sessions
  where sessions.id = p_session_id;

  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if v_visibility = 'private' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_visibility = 'link' then
    if p_join_token is null or p_join_token = '' or p_join_token <> v_join_token then
      raise exception 'invalid token' using errcode = '42501';
    end if;
  end if;

  insert into public.session_participants (id, session_id, user_id, role, created_at)
  values (gen_random_uuid(), p_session_id, auth.uid(), 'participant', now())
  on conflict (session_id, user_id) do nothing;
end;
$$;

create policy "participants select for session members"
on public.session_participants for select
using (public.is_session_member(session_participants.session_id));

insert into app_migrations (id)
values ('20241015_reset_join_functions_force_all')
on conflict (id) do nothing;

create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

drop policy if exists "participants select for session members" on session_participants;

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

create policy "participants select for session members"
on session_participants for select
using (is_session_member(session_participants.session_id));

insert into app_migrations (id)
values ('20241015_fix_session_participants_policy')
on conflict (id) do nothing;

create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table session_logs
  add column if not exists visible_user_ids uuid[];

drop policy if exists "session_logs select for participants" on session_logs;
drop policy if exists "session_logs insert for participants" on session_logs;
drop policy if exists "session_logs select for allowed tabs" on session_logs;
drop policy if exists "session_logs insert for allowed tabs" on session_logs;

create policy "session_logs select for allowed tabs"
on session_logs for select
using (
  can_view_chat_tab(tab_id, session_id)
  and (
    coalesce(array_length(visible_user_ids, 1), 0) = 0
    or auth.uid() = any(visible_user_ids)
    or auth.uid() = user_id
  )
);

create policy "session_logs insert for allowed tabs"
on session_logs for insert
with check (
  can_view_chat_tab(tab_id, session_id)
  and (
    coalesce(array_length(visible_user_ids, 1), 0) = 0
    or auth.uid() = any(visible_user_ids)
  )
);

drop policy if exists "profiles select for session members" on profiles;

create policy "profiles select for session members"
on profiles for select
using (
  exists (
    select 1
    from session_participants sp_self
    join session_participants sp_other
      on sp_other.session_id = sp_self.session_id
    where sp_self.user_id = auth.uid()
      and sp_other.user_id = profiles.id
  )
);

insert into app_migrations (id)
values ('20241017_add_session_log_visibility_and_profile_policy')
on conflict (id) do nothing;

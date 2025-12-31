create table if not exists app_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create or replace function is_session_owner(p_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from session_participants sp
    where sp.session_id = p_session_id
      and sp.user_id = auth.uid()
      and sp.role = 'owner'
  );
$$;

create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists place_patterns (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  name text not null,
  background_url text,
  created_at timestamptz not null default now()
);

create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scene_steps (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  pattern_id uuid references place_patterns(id) on delete set null,
  position integer not null,
  created_at timestamptz not null default now()
);

create unique index if not exists scene_steps_order_unique
on scene_steps (scene_id, position);

create table if not exists scene_states (
  session_id uuid primary key references sessions(id) on delete cascade,
  scene_id uuid references scenes(id) on delete set null,
  step_index integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table places enable row level security;
alter table place_patterns enable row level security;
alter table scenes enable row level security;
alter table scene_steps enable row level security;
alter table scene_states enable row level security;

drop policy if exists "places select for session members" on places;
drop policy if exists "places insert owner" on places;
drop policy if exists "places update owner" on places;
drop policy if exists "places delete owner" on places;

create policy "places select for session members"
on places for select
using (is_session_member(session_id));

create policy "places insert owner"
on places for insert
with check (is_session_owner(session_id));

create policy "places update owner"
on places for update
using (is_session_owner(session_id))
with check (is_session_owner(session_id));

create policy "places delete owner"
on places for delete
using (is_session_owner(session_id));

drop policy if exists "place patterns select for session members" on place_patterns;
drop policy if exists "place patterns insert owner" on place_patterns;
drop policy if exists "place patterns update owner" on place_patterns;
drop policy if exists "place patterns delete owner" on place_patterns;

create policy "place patterns select for session members"
on place_patterns for select
using (
  exists (
    select 1 from places p
    where p.id = place_patterns.place_id
      and is_session_member(p.session_id)
  )
);

create policy "place patterns insert owner"
on place_patterns for insert
with check (
  exists (
    select 1 from places p
    where p.id = place_patterns.place_id
      and is_session_owner(p.session_id)
  )
);

create policy "place patterns update owner"
on place_patterns for update
using (
  exists (
    select 1 from places p
    where p.id = place_patterns.place_id
      and is_session_owner(p.session_id)
  )
)
with check (
  exists (
    select 1 from places p
    where p.id = place_patterns.place_id
      and is_session_owner(p.session_id)
  )
);

create policy "place patterns delete owner"
on place_patterns for delete
using (
  exists (
    select 1 from places p
    where p.id = place_patterns.place_id
      and is_session_owner(p.session_id)
  )
);

drop policy if exists "scenes select for session members" on scenes;
drop policy if exists "scenes insert owner" on scenes;
drop policy if exists "scenes update owner" on scenes;
drop policy if exists "scenes delete owner" on scenes;

create policy "scenes select for session members"
on scenes for select
using (is_session_member(session_id));

create policy "scenes insert owner"
on scenes for insert
with check (is_session_owner(session_id));

create policy "scenes update owner"
on scenes for update
using (is_session_owner(session_id))
with check (is_session_owner(session_id));

create policy "scenes delete owner"
on scenes for delete
using (is_session_owner(session_id));

drop policy if exists "scene steps select for session members" on scene_steps;
drop policy if exists "scene steps insert owner" on scene_steps;
drop policy if exists "scene steps update owner" on scene_steps;
drop policy if exists "scene steps delete owner" on scene_steps;

create policy "scene steps select for session members"
on scene_steps for select
using (
  exists (
    select 1 from scenes s
    where s.id = scene_steps.scene_id
      and is_session_member(s.session_id)
  )
);

create policy "scene steps insert owner"
on scene_steps for insert
with check (
  exists (
    select 1 from scenes s
    where s.id = scene_steps.scene_id
      and is_session_owner(s.session_id)
  )
);

create policy "scene steps update owner"
on scene_steps for update
using (
  exists (
    select 1 from scenes s
    where s.id = scene_steps.scene_id
      and is_session_owner(s.session_id)
  )
)
with check (
  exists (
    select 1 from scenes s
    where s.id = scene_steps.scene_id
      and is_session_owner(s.session_id)
  )
);

create policy "scene steps delete owner"
on scene_steps for delete
using (
  exists (
    select 1 from scenes s
    where s.id = scene_steps.scene_id
      and is_session_owner(s.session_id)
  )
);

drop policy if exists "scene states select for session members" on scene_states;
drop policy if exists "scene states insert owner" on scene_states;
drop policy if exists "scene states update owner" on scene_states;

create policy "scene states select for session members"
on scene_states for select
using (is_session_member(session_id));

create policy "scene states insert owner"
on scene_states for insert
with check (is_session_owner(session_id));

create policy "scene states update owner"
on scene_states for update
using (is_session_owner(session_id))
with check (is_session_owner(session_id));

insert into app_migrations (id)
values ('20241016_add_scene_place_tables')
on conflict (id) do nothing;

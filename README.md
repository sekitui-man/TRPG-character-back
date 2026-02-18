# TRPG-character-back

TRPG キャラクターサイト向けのバックエンド API です。Supabase をデータストアとして利用し、セッション/ボード/トークン/キャラクターを扱う API と WebSocket の変更通知を提供します。認証はフロントエンドの Supabase Auth で行い、API には `Authorization: Bearer <access_token>` を送信します。

## セットアップ

```bash
npm install
npm run start
```

### 環境変数

| 変数名 | 説明 | デフォルト |
| --- | --- | --- |
| `PORT` | HTTP ポート | `3000` |
| `SUPABASE_URL` | Supabase Project URL | - |
| `SUPABASE_ANON_KEY` | Supabase anon key | - |
| `SUPABASE_SERVICE_ROLE_KEY` | Bot API が参照用に使う service role key | - |
| `CORS_ORIGIN` | 許可するフロントURL（カンマ区切り） | `http://localhost:5173` |
| `BOT_API_KEYS` | Bot API 認証キー（カンマ区切りで複数指定可） | - |

## Supabase セットアップ

1. Supabase で新規プロジェクトを作成する。
2. `Project Settings` → `API` から `SUPABASE_URL` と `anon` キーを取得する。
3. `Authentication` → `Providers` で利用するログイン方式（メール/パスワードなど）を有効化する。
   - Discordを使う場合は `URL Configuration` の `Redirect URLs` にフロントのURLを追加します（例: `http://localhost:5173`）。
4. `SQL Editor` でテーブルを作成し、RLS を有効化する（次の SQL 例と参加関数を参照）。
5. `.env` に `SUPABASE_URL` / `SUPABASE_ANON_KEY` を設定する。
6. `npm run start` でバックエンドを起動する。

### Supabase テーブル例

以下のテーブル構成を想定しています。`id` は `uuid` を推奨します。

- `sessions`
  - `id` (uuid, primary key)
  - `name` (text)
  - `visibility` (text: private / link / public)
  - `join_token` (text)
  - `created_at` (timestamptz)

`visibility` は `private`=指定アカウント、`link`=共有リンク、`public`=全公開 の意味です。
`link` の場合は `join_token` を共有リンクに含めます。
- `join_token` は `sessions` にのみ保持します。
- `session_participants`
  - `id` (uuid, primary key)
  - `session_id` (uuid, foreign key -> sessions.id)
  - `user_id` (uuid, auth.uid())
  - `role` (text)
  - `created_at` (timestamptz)
- `boards`
  - `id` (uuid, primary key)
  - `session_id` (uuid, foreign key -> sessions.id)
  - `background_url` (text)
  - `updated_at` (timestamptz)
- `tokens`
  - `id` (uuid, primary key)
  - `session_id` (uuid, foreign key -> sessions.id)
  - `name` (text)
  - `x` (numeric)
  - `y` (numeric)
  - `rotation` (numeric)
  - `image_url` (text)
  - `updated_at` (timestamptz)
- `characters`
  - `id` (uuid, primary key)
  - `name` (text)
  - `system` (text)
  - `level` (text)
  - `background` (text)
  - `notes` (text)
  - `user_id` (uuid, auth.uid())
  - `created_at` (timestamptz)

### SQL 例

```sql
create extension if not exists "pgcrypto";

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visibility text not null default 'private',
  join_token text,
  created_at timestamptz not null default now()
);

create table if not exists session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'participant',
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  background_url text,
  updated_at timestamptz not null default now()
);

create table if not exists tokens (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  x numeric not null,
  y numeric not null,
  rotation numeric not null default 0,
  image_url text,
  updated_at timestamptz not null default now()
);

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  system text,
  level text,
  background text,
  notes text,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table sessions enable row level security;
alter table session_participants enable row level security;
alter table boards enable row level security;
alter table tokens enable row level security;
alter table characters enable row level security;

create policy "sessions select for participants or public"
on sessions for select
using (
  exists (
    select 1 from session_participants
    where session_participants.session_id = sessions.id
      and session_participants.user_id = auth.uid()
  )
  or visibility = 'public'
);

create policy "sessions insert for authenticated"
on sessions for insert
with check (auth.uid() is not null);

create policy "participants self select"
on session_participants for select
using (user_id = auth.uid());

create policy "participants owner self insert"
on session_participants for insert
with check (user_id = auth.uid() and role = 'owner');

create policy "participants owner add"
on session_participants for insert
with check (
  exists (
    select 1 from session_participants sp
    where sp.session_id = session_participants.session_id
      and sp.user_id = auth.uid()
      and sp.role = 'owner'
  )
);

create policy "boards select for participants"
on boards for select
using (exists (
  select 1 from session_participants
  where session_participants.session_id = boards.session_id
    and session_participants.user_id = auth.uid()
));

create policy "boards modify for participants"
on boards for insert
with check (exists (
  select 1 from session_participants
  where session_participants.session_id = boards.session_id
    and session_participants.user_id = auth.uid()
));

create policy "boards update for participants"
on boards for update
using (exists (
  select 1 from session_participants
  where session_participants.session_id = boards.session_id
    and session_participants.user_id = auth.uid()
));

create policy "tokens select for participants"
on tokens for select
using (exists (
  select 1 from session_participants
  where session_participants.session_id = tokens.session_id
    and session_participants.user_id = auth.uid()
));

create policy "tokens insert for participants"
on tokens for insert
with check (exists (
  select 1 from session_participants
  where session_participants.session_id = tokens.session_id
    and session_participants.user_id = auth.uid()
));

create policy "tokens update for participants"
on tokens for update
using (exists (
  select 1 from session_participants
  where session_participants.session_id = tokens.session_id
    and session_participants.user_id = auth.uid()
));

create policy "tokens delete for participants"
on tokens for delete
using (exists (
  select 1 from session_participants
  where session_participants.session_id = tokens.session_id
    and session_participants.user_id = auth.uid()
));

create policy "characters select own"
on characters for select
using (user_id = auth.uid());

create policy "characters insert own"
on characters for insert
with check (user_id = auth.uid());

create policy "characters update own"
on characters for update
using (user_id = auth.uid());

create policy "characters delete own"
on characters for delete
using (user_id = auth.uid());
```

```sql
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

  select visibility, join_token
    into v_visibility, v_join_token
  from sessions
  where id = session_id;

  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if v_visibility = 'private' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_visibility = 'link' then
    if join_token is null or join_token = '' or join_token <> v_join_token then
      raise exception 'invalid token' using errcode = '42501';
    end if;
  end if;

  insert into session_participants (id, session_id, user_id, role, created_at)
  values (gen_random_uuid(), session_id, auth.uid(), 'participant', now())
  on conflict (session_id, user_id) do nothing;
end;
$$;
```

### 既存テーブルの更新例

```sql
alter table sessions add column if not exists visibility text not null default 'private';
alter table sessions add column if not exists join_token text;
alter table session_participants drop column if exists join_token;
alter table sessions alter column id set default gen_random_uuid();
alter table session_participants alter column id set default gen_random_uuid();
alter table boards alter column id set default gen_random_uuid();
alter table tokens alter column id set default gen_random_uuid();
alter table characters alter column id set default gen_random_uuid();
drop policy if exists "participants self join public or link" on session_participants;
```

参加処理用の `join_session_with_token` 関数は上記 SQL 例をそのまま適用してください。

## 認証

ログインはフロントエンドの Supabase Auth で行い、API には `Authorization: Bearer <access_token>` を付けて呼び出します。
`/health` と `/bot/*` を除く API はログイン必須です。

## REST API

### Sessions

- `POST /sessions` セッション作成（`visibility` を指定可能）
- `GET /sessions` セッション一覧
- `GET /sessions/:sessionId` セッション取得
- `POST /sessions/:sessionId/join` セッション参加登録
- `POST /sessions/:sessionId/participants` 参加者追加（オーナーのみ）

`visibility=link` のセッションは `join_token` が必要です。`POST /sessions/:sessionId/join` に `join_token` を送信してください。
`visibility=private` の場合は参加者以外は取得できません。

### Boards

- `GET /sessions/:sessionId/board` ボード取得
- `POST /sessions/:sessionId/board` ボード作成/更新

### Tokens

- `GET /sessions/:sessionId/tokens` トークン一覧
- `POST /sessions/:sessionId/tokens` トークン作成
- `PATCH /tokens/:tokenId` トークン更新
- `DELETE /tokens/:tokenId` トークン削除

### Characters (要認証)

- `GET /characters`
- `POST /characters`
- `PATCH /characters/:characterId`
- `DELETE /characters/:characterId`

### Bot Characters (Bot API key 必須)

以下は Discord Bot などサーバ間連携向けです。`Authorization: Bearer <BOT_API_KEY>` または `x-bot-key` ヘッダーを指定してください。

- `GET /bot/users/:userId/characters`
  - クエリ: `include_sheet=true|false`, `include_private_sheet=true|false`, `limit=1..100`
- `GET /bot/characters/:characterId`
  - クエリ: `include_sheet=true|false`, `include_private_sheet=true|false`, `user_id=<owner_user_id>`

`include_private_sheet=false`（デフォルト）の場合、`character_sheets_coc6.visibility='public'` のシートのみ返します。

### Bot User Resolve (Bot API key 必須)

Discord ユーザーIDと Supabase ユーザーIDの対応を扱います。

- `POST /bot/users/provision`
  - ボディ: `{ "discord_user_id": "<discord_id>" }`
  - リンク未作成なら Supabase Auth ユーザー発行 + 連携作成を行います。
- `GET /bot/users/resolve`
  - クエリ: `discord_user_id=<discord_id>` または `user_id=<supabase_user_id>`
- `PUT /bot/users/resolve`
  - ボディ: `{ "discord_user_id": "...", "user_id": "..." }`

### My Discord Link (要認証)

ログイン中ユーザーの Discord 連携情報を確認/同期します。

- `GET /me/discord-link`
- `POST /me/discord-link/sync`

`/me/discord-link/sync` は Supabase Auth ユーザー情報の Discord identity から
`discord_user_id` を抽出して保存します。既存リンクの所有者が異なる場合は、
キャラクター関連データ（`characters` / `character_sheets_coc6`）の所有者を
現在ユーザーに移管してから更新します。

## リアルタイム通知

`ws://localhost:3000/realtime` に接続すると、`boards` / `tokens` / `sessions` の変更が配信されます。
接続後に次の形式で購読を送信してください（`token` は必須です）。

```json
{
  "type": "subscribe",
  "session_id": "...",
  "token": "SUPABASE_ACCESS_TOKEN"
}
```

```json
{
  "type": "change",
  "table": "tokens",
  "action": "update",
  "record": {
    "id": "...",
    "session_id": "...",
    "name": "...",
    "x": 120,
    "y": 200,
    "rotation": 0,
    "image_url": null,
    "updated_at": "..."
  }
}
```

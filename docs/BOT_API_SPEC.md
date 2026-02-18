# Bot API Specification

## Overview
- Base URL: `http://<host>:<port>`
- Content-Type: `application/json`
- Bot向けAPIは `TRPG-character-back` が提供します。
- BotはDBに直接接続せず、HTTP API経由でアクセスします。

## Authentication
Bot向けエンドポイント（`/bot/*`）は次のどちらかで認証します。
- `Authorization: Bearer <BOT_API_KEY>`
- `x-bot-key: <BOT_API_KEY>`

必要な環境変数:
- `BOT_API_KEYS` (カンマ区切りで複数可)
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

共通エラー:
- `401 {"error":"missing bot authorization"}`
- `401 {"error":"unauthorized"}`
- `500 {"error":"bot auth is not configured"}`
- `500 {"error":"bot api is not configured"}`

## Endpoints

## 1) Resolve User Link
### `POST /bot/users/provision`
Request body:
```json
{
  "discord_user_id": "123456789012345678"
}
```

Behavior:
- 既存リンクがあれば再利用（`created: false`）
- 未作成なら Supabase Auth ユーザーを新規発行し、リンクを作成（`created: true`）

Response `200` or `201`:
```json
{
  "discord_user_id": "123456789012345678",
  "user_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "created_at": "2026-02-18T00:00:00Z",
  "updated_at": "2026-02-18T00:00:00Z",
  "created": true
}
```

Errors:
- `400 {"error":"valid discord_user_id is required"}`

### `GET /bot/users/resolve`
- Query: `discord_user_id` または `user_id`（どちらか必須）
- `discord_user_id` がある場合はそれを優先して検索します。

Response `200`:
```json
{
  "discord_user_id": "123456789012345678",
  "user_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "created_at": "2026-02-18T00:00:00Z",
  "updated_at": "2026-02-18T00:00:00Z"
}
```

Errors:
- `400 {"error":"discord_user_id or user_id is required"}`
- `404 {"error":"link not found"}`

### `PUT /bot/users/resolve`
Request body:
```json
{
  "discord_user_id": "123456789012345678",
  "user_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
}
```

Validation:
- `discord_user_id`: 17-20桁の数字
- `user_id`: UUID

Response `200`: `GET` と同じ形式

Errors:
- `400 {"error":"valid discord_user_id is required"}`
- `400 {"error":"valid user_id is required"}`

## 2) List Characters By Supabase User
### `GET /bot/users/:userId/characters`
Query:
- `include_sheet` （互換用。現在は返却形式に影響しません）
- `include_private_sheet` (`true`/`1` で有効, default: `false`)
- `limit` (`1..100`, default: `50`)

Response `200`:
```json
[
  {
    "kind": "character",
    "data": {
      "name": "『アリス』",
      "initiative": 14,
      "externalUrl": "https://iachara.com/view/8934795",
      "iconUrl": "https://example.com/icon.png",
      "commands": "CCB<=65 【アイデア】",
      "status": [
        { "label": "HP", "value": 13, "max": 13 },
        { "label": "MP", "value": 17, "max": 17 },
        { "label": "SAN", "value": 75, "max": 75 }
      ],
      "params": [
        { "label": "STR", "value": "13" },
        { "label": "CON", "value": "14" },
        { "label": "POW", "value": "17" }
      ]
    },
    "meta": {
      "character_id": "char-id",
      "user_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "system": "coc6",
      "created_at": "2026-02-18T00:00:00Z",
      "has_sheet": true,
      "sheet_visibility": "public",
      "sheet_updated_at": "2026-02-18T00:00:00Z"
    }
  }
]
```

補足:
- `character_sheets_coc6` が無い/非公開の場合でも、`meta.has_sheet=false` で返します。
- `params` は標準8能力値（STR, CON, POW, DEX, APP, SIZ, INT, EDU）に加えて拡張項目を含められます。
- `status` は標準3項目（HP, MP, SAN）に加えて拡張項目を含められます。

## 3) Get Character By ID
### `GET /bot/characters/:characterId`
Query:
- `include_sheet` （互換用。現在は返却形式に影響しません）
- `include_private_sheet` (`true`/`1` で有効, default: `false`)
- `user_id`（指定時は所有者チェック。違う場合 `404`）

Response `200`:
- `List Characters` の単体版と同じ `typed character` 構造

Errors:
- `404 {"error":"character not found"}`

## Related User Endpoint (for app users)
Bot用ではないですが、連携状態確認に利用できます。

### `GET /me/discord-link`
- 認証: Supabase access token (`Authorization: Bearer <access_token>`)
- 自分の連携情報を取得

### `POST /me/discord-link/sync`
- 認証: Supabase access token
- Supabase AuthのDiscord identityから `discord_user_id` を抽出し、連携を保存
- 既存リンクの `user_id` が現在ユーザーと異なる場合、
  `characters` と `character_sheets_coc6` の所有者を現在ユーザーへ移管

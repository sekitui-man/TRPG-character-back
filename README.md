# TRPG-character-back

TRPG キャラクターサイト向けのバックエンド API です。Supabase を直接利用していたフロントを置き換える想定で、セッション/ボード/トークン/キャラクターを扱う API と WebSocket の変更通知を提供します。

## セットアップ

```bash
npm install
npm run start
```

### 環境変数

| 変数名 | 説明 | デフォルト |
| --- | --- | --- |
| `PORT` | HTTP ポート | `3000` |
| `DB_PATH` | SQLite ファイルパス | `./data/app.db` |
| `JWT_SECRET` | JWT 署名用シークレット | `dev-secret` |

## 認証

`POST /auth/token` で簡易トークンを発行します。`Authorization: Bearer <token>` を付与して `/characters` 系 API を利用します。

```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id":"demo-user"}'
```

## REST API

### Sessions

- `POST /sessions` セッション作成
- `GET /sessions` セッション一覧
- `GET /sessions/:sessionId` セッション取得

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

## リアルタイム通知

`ws://localhost:3000/realtime` に接続すると、`boards` / `tokens` / `sessions` の変更が配信されます。

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

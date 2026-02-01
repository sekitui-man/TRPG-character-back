# skills.md

Migration naming rules for `migrations/`.

## Format
Use a timestamp prefix so lexicographic order matches execution order:

`YYYYMMDDHHMMSS_short_description.sql`

- Use local time (JST) for the timestamp.
- All lowercase, snake_case.
- Start with a verb: add/create/update/rename/fix/drop/seed.
- Keep it concise (3-6 words).
- If you need multiple migrations in a row, bump the timestamp to keep names unique.

## Examples
- 20260201113045_add_chat_tabs.sql
- 20260201121510_fix_join_session_function.sql
- 20260202100530_create_scene_place_tables.sql

## Legacy files
Older migrations already use `0001_` or `YYYYMMDD_` prefixes. Keep them as-is.
New migrations must follow the format above.

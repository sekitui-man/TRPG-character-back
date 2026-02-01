# AGENTS.md

Project: TRPG-character-back (Express + Supabase, ESM).

## Quick commands
- npm install
- npm run dev
- npm run start

## Conventions
- ESM only: use `import`/`export` (Node >= 20).
- Keep formatting consistent with existing code (double quotes, semicolons, 2-space indent).
- API errors use JSON `{ error: string }`; prefer `handleSupabaseError` for DB errors.
- Auth is enforced via `requireAuth` / `verifyAuthToken` helpers.
- Do not edit `node_modules` or generated output.

## Migrations
- SQL migrations live in `migrations/`. Do not rename existing files.
- Naming rules are in `skills.md`.

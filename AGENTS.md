# AGENTS.md — Mero

## What this repo is
Browser-based idle RPG. Node.js + Express backend, vanilla HTML/CSS/JS frontend (no build step), SQLite via Turso (libSQL cloud).

## Critical: database driver
Use **`@libsql/client`** (already in `package.json`) — NOT `node:sqlite`, `better-sqlite3`, or `sqlite3`.
All queries go through `server/db.js` which exports `{ client, transaction, initDb }`.
`client.execute(sql, args?)` for single queries; `client.batch([{sql, args}], 'write')` for batches; `transaction(async fn)` for atomic writes.

## Critical: `.env` is not committed
Required vars (see `.env.example`):
- `TURSO_URL` — libSQL URL (e.g. `libsql://...turso.io`)
- `TURSO_AUTH_TOKEN`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `PORT` (default 3000)

When creating a worktree, always `cp .env ./trees/<name>/.env` immediately — the file won't exist otherwise.

## Worktree workflow (mandatory)
```bash
git worktree add ./trees/<name> -b <type>/<name> development
cp .env ./trees/<name>/.env
```
- Branch from `development`, not `main`
- `fix/<name>` for bugs, `feat/<name>` for features
- All work inside `./trees/<name>/`

## Dev commands
```bash
npm run dev    # nodemon server/index.js — auto-restarts on changes
npm start      # node server/index.js — production
```
No build step. No lint config. Verify changes manually or with `smoke-test.js`.

## Test commands
```bash
npm test              # vitest run — run full suite (95 tests across 8 files)
npm run test:watch    # vitest — watch mode
npm run test:coverage # vitest run --coverage
```
**Stack**: Vitest 4 + Supertest. No real DB connection — all tests mock `client.execute` and `client.batch` via `vi.spyOn`.

### Testing patterns
- All server modules loaded via `createRequire(import.meta.url)` (CJS require cache, not ESM)
- `protect` middleware replaced via `require.cache[protectPath]` before route is loaded
- `helpers.fullChar` replaced via `require.cache[helpersPath]` before game/market routes load
- DB spies: `vi.spyOn(db.client, 'execute')` and `vi.spyOn(db.client, 'batch')` — chain `.mockResolvedValueOnce()` in call order
- `Math.random` mock: use `0.5` for combat tests (50 < hitChance=70 → player hits; 50 >= drop_chance → no gear drop)

## Schema and migrations
`server/db.js → initDb()` runs on every startup:
- `CREATE TABLE IF NOT EXISTS` for all tables
- Additive `ALTER TABLE` migrations in an array — each wrapped in `try/catch` to skip if column exists
- **Add new columns here**, not in a separate migration file
- Monster and item seed data is idempotent (`INSERT OR IGNORE`, seeded only if `COUNT(*) = 0` per dungeon_set)

## Route map
| Mount | File |
|---|---|
| `/api/auth` | `server/routes/auth.js` |
| `/api/characters` | `server/routes/characters.js` |
| `/api/game` | `server/routes/game.js` |
| `/api/farm` | `server/routes/farm.js` |
| `/api/market` | `server/routes/market.js` |

SPA fallback: all non-asset `GET *` routes return `public/index.html`.

## Frontend
Plain files in `public/` — no bundler, no framework. JS in `public/js/`. Tailwind via CDN.
Avatar uploads stored in `public/avatars/` (auto-created, gitignored).

## Auth pattern
- Access token: stored in `sessionStorage`, sent as `Authorization: Bearer <token>`
- Refresh token: httpOnly cookie
- Middleware: `server/middleware/protect.js`

## Passwords
Use **`bcryptjs`** (pure JS) — NOT `bcrypt`.

## Dungeon sets unlock levels
- Set 1 — Verdant Wilds: level 1+
- Set 2 — Volcanic Depths: level 20+
- Set 3 — Frozen Wastes: level 30+
- Set 4 — Thunder Peaks: level 40+
- Set 5 — Void Realm: level 50+

## max_hp formula
`10 + (level - 1) * 5 + attr_vitality * 2`

## XP threshold formula
`10 × 1.5^(level − 1)`

# Mero — Claude Code Rules

## Worktree workflow (mandatory)

Every new feature or bug fix **must** be worked in a dedicated git worktree. Never work directly on `main` for new changes.

### Pattern
```
git worktree add ./trees/<feature_or_fix_name> -b <type>/<feature_or_fix_name>
```
- Path: `./trees/<name>` (use underscores, e.g. `fix_xp_gain`, `feat_leaderboard`)
- Branch: `fix/<name>` for bugs, `feat/<name>` for features

### Steps for every task
1. Create the worktree with the command above
2. **Immediately copy `.env`**: `cp .env ./trees/<name>/.env`
3. Do all work inside the worktree directory
4. Commit inside the worktree when done
5. Tell the user to merge: `git merge fix/<name>` from `main`

Do not ask the user whether to create a worktree — just do it automatically.
The `.env` copy step is mandatory — the file is gitignored and won't exist in the worktree otherwise.

## Tech notes
- Database: `node:sqlite` built-in (Node 22+) — do NOT use `better-sqlite3` or `sqlite3`
- Passwords: `bcryptjs` (pure JS) — do NOT use `bcrypt`
- No build step — plain HTML/CSS/JS in `public/`
- Node.js >= 22.5.0 required

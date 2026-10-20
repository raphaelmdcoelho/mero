# Mero — Claude Code Rules

## Worktree workflow (mandatory)

Every new feature or bug fix **must** be worked in a dedicated git worktree. Never work directly on `main` for new changes.

### Pattern
```
git worktree add ./trees/<feature_or_fix_name> -b <type>/<feature_or_fix_name> development
```
- Path: `./trees/<name>` (use underscores, e.g. `fix_xp_gain`, `feat_leaderboard`)
- Branch: `fix/<name>` for bugs, `feat/<name>` for features
- Always branch off `development` (the third argument above)

### Steps for every task
1. Create the worktree with the command above (branching from `development`)
2. **Immediately copy `.env`**: `cp .env ./trees/<name>/.env`
3. Do all work inside the worktree directory
4. Commit inside the worktree when done
5. **Submit the work as a Pull Request** (see below) — do not just tell the user to merge locally

### Pull requests (mandatory)
Every change must reach `development` through a PR, never by a local merge or a direct push to `development`/`main`.
- Push the branch: `git push -u origin <type>/<name>`
- Open the PR with `gh pr create --base development --head <type>/<name>`
- Title: conventional-commit style, same as the commit (e.g. `feat: ...`, `fix: ...`)
- Body: what changed and why, how it was verified (tests run, screenshots/manual checks), and any known risks or follow-ups
- If pushing or `gh` is unavailable (no remote access / not authenticated), commit as usual and tell the user exactly which commands to run
- After opening the PR, give the user the PR link; do not merge it yourself
- Keep one PR per feature/fix; if branches touch the same files, say which should merge first

Do not ask the user whether to create a worktree — just do it automatically.
The `.env` copy step is mandatory — the file is gitignored and won't exist in the worktree otherwise.

## Tech notes
- Database: `node:sqlite` built-in (Node 22+) — do NOT use `better-sqlite3` or `sqlite3`
- Passwords: `bcryptjs` (pure JS) — do NOT use `bcrypt`
- No build step — plain HTML/CSS/JS in `public/`
- Node.js >= 22.5.0 required

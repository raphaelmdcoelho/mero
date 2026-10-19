# Mero — Browser Idle RPG

A browser-based idle/incremental RPG. Register, create a hero, and send them into dungeons or taverns while XP ticks up and HP ebbs and flows.

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite3 via Node.js built-in `node:sqlite` (Node 22+)
- **Frontend**: Vanilla HTML/CSS/JS + Tailwind CSS (CDN)
- **Auth**: JWT (access token in `sessionStorage` + httpOnly refresh cookie)

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in values
cp .env.example .env
# Edit .env: set JWT_SECRET and JWT_REFRESH_SECRET to long random strings

# 3. Start dev server (auto-restarts on file changes)
npm run dev
# → http://localhost:3000

# 4. The SQLite database (mero.db) is created automatically on first run
```

## Project Structure

```
mero/
├── server/
│   ├── index.js           # Express entry point
│   ├── db.js              # SQLite setup + migrations + seed
│   ├── auth.js            # JWT helpers
│   ├── routes/
│   │   ├── auth.js        # POST /api/auth/register|login|refresh|logout
│   │   ├── characters.js  # CRUD + avatar upload + equip
│   │   └── game.js        # start/stop/tick actions
│   └── middleware/
│       └── protect.js     # JWT verification
├── public/
│   ├── index.html         # Login / Register
│   ├── characters.html    # Character selection / creation
│   ├── game.html          # Main game screen
│   ├── css/style.css
│   ├── js/
│   │   ├── api.js
│   │   ├── auth.js
│   │   ├── characters.js
│   │   └── game.js
│   └── avatars/           # Uploaded avatar images (auto-created)
├── .env.example
├── package.json
├── README.md
└── DEPLOY.md
```

## Dev Tools

### ShedR — Avatar Studio

Local-only tool that makes equipment sit correctly on **every** avatar, instead of hand-tuning CSS per slot.
Instead of storing one position per slot, it stores:

1. **Landmarks** per avatar — boxes for `head`, `torso`, `hands`, `feet`, `shield` (measured once per body)
2. **Rules** per slot — how a sprite's *visible* area is fitted into a landmark (armor = torso width, etc.)
3. **Overrides** — rare per-sprite, per-avatar nudges

Everything is saved to `public/data/avatar-fit.json`; the game computes positions from it with
`public/js/avatar-fit.js` (the same code the studio uses, covered by `tests/avatar-fit.test.js`).

```
npm run canvas        # http://localhost:3001
```

The studio has an interactive tutorial (opens on first visit; reopen with the **?** button) and a
**Check all** view that tests every item on every avatar and flags bad fits, plus a **Prompts** tab that builds ready-to-paste image-generation prompts for new items (type, name, style, gender → correct canvas size, transparent background, and this game's art style). Templates live in `tools/avatar-canvas/prompts.json`. Workflow:
**Landmarks → Fit → Check all → Save**, then commit the JSON. Adding a new item usually needs no manual positioning.

This tool and its data are not part of any deployment except `avatar-fit.json`, which the game reads at runtime.

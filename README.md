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

## Game Mechanics

| Mechanic | Details |
|----------|---------|
| **Classes** | Warrior ⚔️, Mage 🔮, Rogue 🗡️, Cleric ✝️ |
| **Dungeon** | Easy (+1 XP/min, −1 HP/min), Medium (+2/−2), Hard (+4/−4) |
| **Tavern** | +2 HP/min, capped at max HP |
| **Level-up** | XP threshold: `10 × 1.5^(level−1)` — full HP restore |
| **Tick** | Client polls `/api/game/:id/tick` every 5 seconds |
| **Inventory** | 10 slots per character |

## API Overview

```
POST /api/auth/register      — create account
POST /api/auth/login         — authenticate
POST /api/auth/refresh       — refresh access token (uses httpOnly cookie)
POST /api/auth/logout        — clear cookie

GET  /api/characters         — list your characters
POST /api/characters         — create character
DELETE /api/characters/:id   — delete character
POST /api/characters/:id/avatar  — upload JPEG avatar (max 1 MB)
PUT  /api/characters/:id/equip   — equip weapon or armor

POST /api/game/:id/start     — start dungeon or tavern activity
POST /api/game/:id/stop      — stop current activity
GET  /api/game/:id/tick      — apply elapsed time, return state
```

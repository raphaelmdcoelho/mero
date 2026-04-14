# Deploying Mero to Render.com (Free Tier)

## Prerequisites
- GitHub account with the `mero` repo pushed
- Render.com account (free)

## Steps

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-username>/mero.git
git push -u origin main
```

### 2. Create a Web Service on Render
1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repository
3. Configure the service:
   - **Name**: `mero` (or any name — this determines the URL)
   - **Region**: pick closest to you
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server/index.js`

### 3. Add Environment Variables
In the Render dashboard → **Environment** tab, add:

| Key | Value |
|-----|-------|
| `JWT_SECRET` | A long random string (e.g. 64 hex chars) |
| `JWT_REFRESH_SECRET` | Another long random string |
| `NODE_ENV` | `production` |

Generate secrets with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

### 4. Deploy
Click **Create Web Service**. Render will build and deploy automatically.

Your live URL will be: `https://mero-<hash>.onrender.com`

Render also auto-deploys whenever you push to `main`.

## Important: SQLite Persistence Warning

> **Free tier uses an ephemeral disk.** Data (mero.db) will reset on every redeploy or service restart.

**Options for persistence:**
1. **Render Persistent Disk** (paid): Add a disk in the Render dashboard and set `DB_PATH` env var to `/data/mero.db`, update `server/db.js` to use `process.env.DB_PATH`.
2. **Render PostgreSQL** (free 90-day trial): Migrate queries to `pg` driver.
3. **Turso** (free SQLite-compatible cloud DB): Drop-in replacement for `better-sqlite3` using their libSQL client.

## Custom Domain (optional)
In Render dashboard → **Settings** → **Custom Domain** → add your domain and follow DNS instructions.

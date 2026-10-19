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
| `TURSO_URL` | `libsql://<db>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | Token of the Turso database |
| `NODE_ENV` | `production` |

Generate secrets with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

### 4. Deploy
Click **Create Web Service**. Render will build and deploy automatically.

Your live URL will be: `https://mero-<hash>.onrender.com`

Render also auto-deploys whenever you push to `main`.

## Continuous integration

`.github/workflows/ci.yml` runs `npm test` (Node 22) on every pull request and push to `development` and `main`. It needs no secrets: `tests/setup.js` injects fake values.

To block broken deploys: in Render → **Settings** → **Build & Deploy** → **Auto-Deploy**, choose **After CI Checks Pass**. Optionally, in GitHub → **Settings** → **Branches**, protect `main` and require the `Tests (Node 22)` check.

## Database

Data lives in Turso (libSQL), so it survives redeploys and restarts of the Render free tier. Locally, use `TURSO_URL=file:./dev.db`.

## Custom Domain (optional)
In Render dashboard → **Settings** → **Custom Domain** → add your domain and follow DNS instructions.

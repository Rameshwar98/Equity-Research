## Equity Analysis Dashboard (Private Client MVP)

Monorepo with:
- `frontend/`: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Table
- `backend/`: FastAPI + pandas/numpy/yfinance + SQLite caching + latest-run JSON

### Quick start (local)

#### 1) Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Backend health check: `http://localhost:8000/api/health`

#### 2) Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open: `http://localhost:3000`

### Environment variables

- **Frontend**: set `NEXT_PUBLIC_API_BASE_URL` in `frontend/.env.local`
- **Backend**: set `APP_ENV`, `CACHE_DIR`, `DB_PATH`, `ALLOWED_ORIGINS` in `backend/.env`

### Deployment notes

#### Vercel (frontend)
- Framework preset: Next.js
- Root directory: `frontend`
- Env var: `NEXT_PUBLIC_API_BASE_URL` pointing to your Render backend, e.g. `https://your-backend.onrender.com`

#### Render (backend)
- Service type: Web Service
- Root directory: `backend`
- Build command:

```bash
pip install -r requirements.txt
```

- Start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

**Persistent storage (required for portfolios)**  
Portfolios and rebalance snapshots are stored in `portfolios.json` under `DATA_DIR` (defaults to `CACHE_DIR`). If you use `/tmp`, data is **wiped on every deploy or idle restart** — you will see `Portfolio not found (404)` for old URLs.

1. Upgrade the Render service to a **paid** plan (persistent disks are not on the free tier).
2. Attach a disk (Dashboard → your Web Service → **Disks** → Add disk):
   - **Mount path:** `/var/data`
   - **Size:** 1 GB or more
3. Set env vars (or use the repo root `render.yaml` Blueprint):

| Variable | Example |
|----------|---------|
| `APP_ENV` | `production` |
| `DATA_DIR` | `/var/data/equity` |
| `CACHE_DIR` | `/var/data/equity` |
| `DB_PATH` | `/var/data/equity/equity.db` |
| `PERSIST_CACHE` | `true` |
| `ALLOWED_ORIGINS` | `https://your-vercel-app.vercel.app` |
| `FMP_API_KEY` | (your key) |

4. Redeploy once. Create portfolios again on production (local `portfolios.json` is not copied automatically).

Verify: `GET https://your-api.onrender.com/api/health` should show `storage_ephemeral: false` and `data_dir: /var/data/equity`.

**Migrate existing local data to Render (optional)**  
Copy `backend/cache/portfolios.json` and `backend/cache/portfolio_tracking.db` into the disk folder via Render Shell or a one-off upload, then restart the service.


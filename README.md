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

- Env vars:
  - `APP_ENV=production`
  - `CACHE_DIR=/tmp/equity-cache`
  - `DB_PATH=/tmp/equity-cache/equity.db`
  - `ALLOWED_ORIGINS=https://your-vercel-app.vercel.app`


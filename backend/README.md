## Backend (FastAPI)

### Run locally

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Endpoints

- `GET /api/health`
- `GET /api/indices`
- `GET /api/index/{index_name}/constituents`
- `POST /api/run-analysis`
- `GET /api/stock/{symbol}/details`


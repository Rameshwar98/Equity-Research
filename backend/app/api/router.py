from __future__ import annotations

from fastapi import APIRouter

from app.api.routes.analysis import router as analysis_router
from app.api.routes.health import router as health_router
from app.api.routes.indices import router as indices_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router, tags=["health"])
api_router.include_router(indices_router, tags=["indices"])
api_router.include_router(analysis_router, tags=["analysis"])


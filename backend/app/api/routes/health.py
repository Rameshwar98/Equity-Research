from __future__ import annotations

from fastapi import APIRouter

from app.schemas.common import HealthResponse
from app.utils.time import utc_now

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", timestamp=utc_now())


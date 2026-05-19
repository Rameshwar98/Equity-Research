from __future__ import annotations

from fastapi import APIRouter

from app.schemas.common import HealthResponse
from app.utils.time import utc_now

router = APIRouter()


def _is_ephemeral(path: str) -> bool:
    p = path.replace("\\", "/").lower()
    return p == "/tmp" or p.startswith("/tmp/")


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    from app.main import settings

    data_dir = settings.data_dir
    return HealthResponse(
        status="ok",
        timestamp=utc_now(),
        data_dir=data_dir,
        cache_dir=settings.cache_dir,
        storage_ephemeral=_is_ephemeral(data_dir),
    )


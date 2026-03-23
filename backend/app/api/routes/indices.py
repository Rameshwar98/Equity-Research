from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.common import Constituent, IndexInfo
from app.services.universe_service import UniverseService

router = APIRouter()


def get_universe_service() -> UniverseService:
    # late import to avoid cycles
    from app.main import universe_service

    return universe_service


@router.get("/indices", response_model=list[IndexInfo])
async def list_indices(svc: UniverseService = Depends(get_universe_service)) -> list[IndexInfo]:
    return svc.list_indices()


@router.get("/index/{index_name}/constituents", response_model=list[Constituent])
async def constituents(index_name: str, svc: UniverseService = Depends(get_universe_service)) -> list[Constituent]:
    try:
        u = svc.get_universe(index_name)
        return u.constituents
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


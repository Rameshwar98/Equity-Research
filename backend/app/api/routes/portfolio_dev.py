from __future__ import annotations

from fastapi import APIRouter

from app.schemas.portfolio import GenerateTestHistoryResponse
from app.services.portfolio_test_history import run_generate_portfolio_test_history

router = APIRouter()


@router.post(
    "/{portfolio_id}/generate-test-history",
    response_model=GenerateTestHistoryResponse,
)
async def generate_test_history(portfolio_id: str) -> GenerateTestHistoryResponse:
    """POST /api/dev/portfolios/{id}/generate-test-history"""
    return await run_generate_portfolio_test_history(portfolio_id)

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes.analysis import router as analysis_router
from app.api.routes.health import router as health_router
from app.api.routes.indices import router as indices_router
from app.api.routes.portfolios import router as portfolios_router
from app.api.routes.portfolio_analytics import router as portfolio_analytics_router
from app.api.routes.portfolio_history import router as portfolio_history_router
from app.api.routes.portfolio_schedule import router as portfolio_schedule_router
from app.api.routes.portfolio_price_history import router as portfolio_price_history_router
from app.api.routes.portfolio_dev import router as portfolio_dev_router
from app.api.routes.rebalance import router as rebalance_router

api_router = APIRouter(prefix="/api")
dev_router = APIRouter(prefix="/dev")
dev_router.include_router(portfolio_dev_router, prefix="/portfolios", tags=["dev"])
api_router.include_router(health_router, tags=["health"])
api_router.include_router(indices_router, tags=["indices"])
api_router.include_router(analysis_router, tags=["analysis"])
api_router.include_router(portfolios_router, tags=["portfolios"])
api_router.include_router(portfolio_analytics_router, tags=["portfolios"])
api_router.include_router(portfolio_history_router, tags=["portfolios"])
api_router.include_router(portfolio_schedule_router, tags=["portfolios"])
api_router.include_router(portfolio_price_history_router, tags=["portfolios"])
api_router.include_router(rebalance_router, tags=["portfolios"])
api_router.include_router(dev_router)



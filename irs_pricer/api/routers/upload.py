"""Upload endpoint: the four mandatory market-data/portfolio Excel files
that gate entry to the frontend's dashboard."""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile

from ...services import upload_service
from ..models import FileUploadResult, MarketDataUploadResponse, ParsedPositionOut

router = APIRouter(prefix="/api/upload")


@router.post("/market-data", response_model=MarketDataUploadResponse)
async def upload_market_data(
    irs_data: UploadFile = File(...),
    credit_matrix: UploadFile = File(...),
    bok_base_rate: UploadFile = File(...),
    portfolio: UploadFile = File(...),
) -> MarketDataUploadResponse:
    file_bytes = {
        "irs_data": await irs_data.read(),
        "credit_matrix": await credit_matrix.read(),
        "bok_base_rate": await bok_base_rate.read(),
        "portfolio": await portfolio.read(),
    }
    success, results, positions = upload_service.process_upload(file_bytes)
    return MarketDataUploadResponse(
        success=success,
        irs_data=FileUploadResult(**results["irs_data"]),
        credit_matrix=FileUploadResult(**results["credit_matrix"]),
        bok_base_rate=FileUploadResult(**results["bok_base_rate"]),
        portfolio=FileUploadResult(**results["portfolio"]),
        positions=[ParsedPositionOut(**p) for p in positions],
    )

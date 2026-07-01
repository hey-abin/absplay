from fastapi import APIRouter, HTTPException, status
from backend.models.requests import AnalyzeRequest
from backend.models.responses import AnalyzeResponse
from backend.services.yt_dlp_service import analyze_url

router = APIRouter(tags=["Analysis"])

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    """
    Analyze the provided URL and return media metadata
    such as title, thumbnail, duration, formats, or playlist entries.
    """
    if not request.url or not request.url.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL is required"
        )
        
    try:
        metadata = analyze_url(request.url)
        return metadata
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while analyzing the URL: {str(e)}"
        )

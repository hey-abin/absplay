# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional, List

class AnalyzeRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    format_id: Optional[str] = "best"
    type: str = "video"  # "video" or "audio" or "playlist"
    quality: Optional[str] = "best"  # "1080p", "720p", "480p", "360p", "128kbps", "192kbps", etc.
    selected_items: Optional[List[int]] = None  # Indices of selected items in the playlist (0-indexed)

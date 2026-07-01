from pydantic import BaseModel, Field
from typing import Optional, List, Any

class FormatInfo(BaseModel):
    format_id: str
    ext: str
    resolution: Optional[str] = None
    filesize: Optional[int] = None
    note: Optional[str] = None
    fps: Optional[float] = None
    vcodec: Optional[str] = None
    acodec: Optional[str] = None

class PlaylistItemInfo(BaseModel):
    id: str
    title: str
    duration: Optional[int] = None
    thumbnail: Optional[str] = None
    index: int

class AnalyzeResponse(BaseModel):
    title: str
    thumbnail: Optional[str] = None
    duration: Optional[int] = None
    creator: Optional[str] = None
    formats: List[FormatInfo] = []
    is_playlist: bool = False
    playlist_entries: List[PlaylistItemInfo] = []
    url_type: str = Field(alias="urlType", default="youtube_video")
    is_music: bool = Field(alias="isMusic", default=False)
    supports_video: bool = Field(alias="supportsVideo", default=True)
    supports_audio: bool = Field(alias="supportsAudio", default=True)

class DownloadResponse(BaseModel):
    task_id: str

class ProgressResponse(BaseModel):
    task_id: str
    status: str  # pending, downloading, converting, completed, failed, cancelled
    progress: float
    speed: Optional[str] = None
    eta: Optional[str] = None
    error: Optional[str] = None
    filename: Optional[str] = None
    title: Optional[str] = None

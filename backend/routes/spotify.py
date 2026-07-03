# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, BackgroundTasks
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, HttpUrl, Field
from typing import Optional, List, Dict, Any
import uuid

from backend.services.url_detector import detect_url_type
from backend.services.spotify_service import get_track_metadata, get_playlist_metadata
from backend.services.youtube_matcher import get_best_match
from backend.services.yt_dlp_service import task_store, run_download_task
import os

router = APIRouter()

class SpotifyAnalyzeRequest(BaseModel):
    url: HttpUrl

class SpotifyAnalyzeResponse(BaseModel):
    url_type: str = Field(alias="urlType")
    is_music: bool = Field(alias="isMusic")
    is_playlist: bool = Field(alias="isPlaylist")
    supports_video: bool = Field(alias="supportsVideo")
    supports_audio: bool = Field(alias="supportsAudio")
    
    # Spotify Metadata
    title: str
    artist: str = ""
    artwork: str = ""
    duration: int = 0
    total_tracks: Optional[int] = None
    tracks: Optional[List[Dict[str, Any]]] = None
    
    # Match Data (only for single track)
    youtube_match: Optional[Dict[str, Any]] = Field(alias="youtubeMatch", default=None)

class SpotifyDownloadRequest(BaseModel):
    url: str
    selected_items: Optional[List[int]] = None

@router.post("/analyze", response_model=SpotifyAnalyzeResponse, response_model_by_alias=True)
def analyze_spotify_url(req: SpotifyAnalyzeRequest):
    url_str = str(req.url)
    url_info = detect_url_type(url_str)
    
    if not url_info.get("isSpotify"):
        raise HTTPException(status_code=400, detail="Not a valid Spotify URL")
        
    try:
        if url_info["isPlaylist"]:
            metadata = get_playlist_metadata(url_str)
            return SpotifyAnalyzeResponse(
                urlType=url_info["urlType"],
                isMusic=True,
                isPlaylist=True,
                supportsVideo=False,
                supportsAudio=True,
                title=metadata["title"],
                artwork=metadata["artwork"],
                total_tracks=metadata["total_tracks"],
                tracks=metadata["tracks"]
            )
        else:
            metadata = get_track_metadata(url_str)
            youtube_match = get_best_match(metadata)
            
            return SpotifyAnalyzeResponse(
                urlType=url_info["urlType"],
                isMusic=True,
                isPlaylist=False,
                supportsVideo=False,
                supportsAudio=True,
                title=metadata["title"],
                artist=metadata["artist"],
                artwork=metadata["artwork"],
                duration=metadata["duration_sec"],
                youtubeMatch=youtube_match
            )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/download")
def download_spotify(req: SpotifyDownloadRequest, background_tasks: BackgroundTasks):
    url_info = detect_url_type(req.url)
    if not url_info.get("isSpotify"):
        raise HTTPException(status_code=400, detail="Not a valid Spotify URL")
        
    task_id = task_store.create_task(req.url, "audio")
    
    background_tasks.add_task(_process_spotify_download, task_id, req)
    
    return {"task_id": task_id, "message": "Spotify download task started"}

@router.get("/progress/{task_id}")
def get_spotify_progress(task_id: str):
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

def _process_spotify_download(task_id: str, req: SpotifyDownloadRequest):
    """
    Background task to process Spotify downloads.
    """
    url_info = detect_url_type(req.url)
    
    try:
        if url_info["isPlaylist"]:
            task_store.update_task(task_id, status="fetching_metadata", title="Spotify Playlist", progress=0)
            
            metadata = get_playlist_metadata(req.url)
            tracks = metadata["tracks"]
            
            if req.selected_items is not None:
                tracks = [t for t in tracks if t["index"] in req.selected_items]
                
            task_store.update_task(task_id, title=metadata["title"])
            
            # Since yt-dlp_service requires a list of items for playlist processing, we'll
            # need to match them all, then we can use yt_dlp_service's run_download_task logic?
            # Wait, yt_dlp_service.py `_download_music_playlist` expects `req.url` to be a youtube url.
            # It's better to match all selected tracks, collect their YouTube URLs, and pass them to a custom
            # downloader, OR update yt_dlp_service to handle it.
            # To avoid modifying yt_dlp_service too much, we can implement the multi-file download loop here.
            import yt_dlp
            import shutil
            from backend.services.yt_dlp_service import _get_audio_opts, _my_hook
            
            task_temp_dir = os.path.join("downloads", "temp", task_id)
            os.makedirs(task_temp_dir, exist_ok=True)
            
            total = len(tracks)
            
            for idx, track in enumerate(tracks):
                task_store.update_task(task_id, status="matching", progress=(idx / total) * 100, error=f"Matching: {track['title']}")
                
                try:
                    from backend.services.youtube_matcher import get_all_matches
                    matches = get_all_matches(track)
                    success = False
                    last_error = None
                    
                    for match in matches:
                        yt_url = match["youtube_url"]
                        
                        ydl_opts = _get_audio_opts("best")
                        ydl_opts['outtmpl'] = os.path.join(task_temp_dir, '%(title)s.%(ext)s')
                    
                    # Update hook for overall progress
                    def progress_hook(d):
                        if d['status'] == 'downloading':
                            downloaded = d.get('downloaded_bytes', 0)
                            total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                            percent = (downloaded / total_bytes * 100) if total_bytes else 0
                            
                            overall_progress = ((idx * 100.0) + percent) / total
                            overall_progress = min(max(overall_progress, 0.0), 99.9)
                            
                            speed = d.get('_speed_str', 'N/A').strip()
                            eta = d.get('_eta_str', 'N/A').strip()
                            
                            task_store.update_task(
                                task_id,
                                status="downloading",
                                progress=overall_progress,
                                speed=speed,
                                eta=eta,
                                error=f"Downloading {idx+1}/{total}: {track['title']}"
                            )
                            
                    ydl_opts['progress_hooks'] = [progress_hook]
                    
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        try:
                            ydl.download([yt_url])
                            success = True
                            break
                        except Exception as inner_e:
                            last_error = inner_e
                            import logging
                            logging.getLogger(__name__).warning(f"Failed to download {yt_url} for {track['title']}: {inner_e}")
                            
                    if not success:
                        raise Exception(f"All matched YouTube URLs failed. Last error: {last_error}")
                        
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).error(f"Failed to process track {track['title']}: {e}")
                    # Continue with next track
            
            # Zip it
            task_store.update_task(task_id, status="converting", progress=99.0, error="Zipping files...")
            zip_filename = f"{task_id}.zip"
            zip_path = os.path.join("downloads", zip_filename)
            
            shutil.make_archive(zip_path.replace('.zip', ''), 'zip', task_temp_dir)
            shutil.rmtree(task_temp_dir)
            
            task_store.update_task(
                task_id,
                status="completed",
                progress=100.0,
                filename="AbsPlay-package.zip",
                download_path=zip_path,
                error=None
            )
            
        else:
            task_store.update_task(task_id, status="matching", title="Spotify Track", progress=0)
            
            metadata = get_track_metadata(req.url)
            
            from backend.services.youtube_matcher import get_all_matches
            matches = get_all_matches(metadata)
            
            task_store.update_task(task_id, title=metadata["title"], status="downloading", progress=10)
            
            import yt_dlp
            from backend.services.yt_dlp_service import _get_audio_opts
            
            ydl_opts = _get_audio_opts("best")
            ydl_opts['outtmpl'] = os.path.join("downloads", '%(title)s.%(ext)s')
            
            def single_progress_hook(d):
                if d['status'] == 'downloading':
                    downloaded = d.get('downloaded_bytes', 0)
                    total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                    percent = (downloaded / total_bytes * 100) if total_bytes else 0
                    
                    speed = d.get('_speed_str', 'N/A').strip()
                    eta = d.get('_eta_str', 'N/A').strip()
                    
                    task_store.update_task(
                        task_id,
                        status="downloading",
                        progress=percent,
                        speed=speed,
                        eta=eta
                    )
            
            ydl_opts['progress_hooks'] = [single_progress_hook]
            
            success = False
            last_error = None
            final_filename = None
            
            for match in matches:
                yt_url = match["youtube_url"]
                try:
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        info = ydl.extract_info(yt_url, download=True)
                        filename = ydl.prepare_filename(info)
                        # change ext to mp3 because of postprocessor
                        final_filename = os.path.splitext(filename)[0] + ".mp3"
                        success = True
                        break
                except Exception as inner_e:
                    last_error = inner_e
                    import logging
                    logging.getLogger(__name__).warning(f"Failed to download single track from {yt_url}: {inner_e}")
                    
            if not success:
                raise Exception(f"All matched YouTube URLs failed. Last error: {last_error}")
                
            task_store.update_task(
                task_id,
                status="completed",
                progress=100.0,
                filename=os.path.basename(final_filename),
                download_path=final_filename
            )
            
    except Exception as e:
        task_store.update_task(task_id, status="failed", error=str(e))

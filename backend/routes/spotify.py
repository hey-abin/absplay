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

class AnalyzeResponse(BaseModel):
    task_id: str
    message: str

class TrackItem(BaseModel):
    title: str
    youtube_url: Optional[str] = None
    spotify_metadata: Optional[Dict[str, Any]] = None

class SpotifyDownloadRequest(BaseModel):
    url: str
    tracks: List[TrackItem]
    is_playlist: bool = False
    title: str = "Spotify Playlist"

@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_spotify_url(req: SpotifyAnalyzeRequest, background_tasks: BackgroundTasks):
    url_str = str(req.url)
    url_info = detect_url_type(url_str)
    
    if not url_info.get("isSpotify"):
        raise HTTPException(status_code=400, detail="Not a valid Spotify URL")
        
    task_id = task_store.create_task(url_str, "analysis")
    background_tasks.add_task(_process_spotify_analyze, task_id, url_str, url_info)
    
    return {"task_id": task_id, "message": "Spotify analysis task started"}

def _process_spotify_analyze(task_id: str, url_str: str, url_info: dict):
    try:
        task_store.update_task(task_id, status="analyzing", progress=0, title="Fetching Spotify metadata...")
        if url_info["isPlaylist"]:
            metadata = get_playlist_metadata(url_str)
            tracks = metadata["tracks"]
            total = len(tracks)
            
            task_store.update_task(task_id, status="completed", progress=100.0, title="Analysis Complete", result={
                "urlType": url_info["urlType"],
                "isMusic": True,
                "isPlaylist": True,
                "supportsVideo": False,
                "supportsAudio": True,
                "title": metadata["title"],
                "artwork": metadata["artwork"],
                "total_tracks": metadata["total_tracks"],
                "tracks": tracks
            })
        else:
            task_store.update_task(task_id, status="analyzing", progress=50, title="Matching track...")
            metadata = get_track_metadata(url_str)
            from backend.services.youtube_matcher import get_best_match
            youtube_match = get_best_match(metadata)
            
            task_store.update_task(task_id, status="completed", progress=100.0, title="Analysis Complete", result={
                "urlType": url_info["urlType"],
                "isMusic": True,
                "isPlaylist": False,
                "supportsVideo": False,
                "supportsAudio": True,
                "title": metadata["title"],
                "artist": metadata["artist"],
                "artwork": metadata["artwork"],
                "duration": metadata["duration_sec"],
                "youtubeMatch": youtube_match
            })
    except Exception as e:
        task_store.update_task(task_id, status="failed", error=str(e))


@router.post("/download")
def download_spotify(req: SpotifyDownloadRequest, background_tasks: BackgroundTasks):
    if not req.tracks:
        raise HTTPException(status_code=400, detail="No tracks provided for download")
        
    if req.is_playlist and len(req.tracks) > 1:
        clean_title = req.title.replace("/", "-").replace("\\", "-")
        zip_title = f"AbsPlay-{clean_title}"
        task_id = task_store.create_task(req.url, "playlist", title=f"{zip_title}.zip")
        background_tasks.add_task(_process_spotify_playlist_zip, task_id, zip_title, req.tracks)
        return {"task_ids": [task_id], "message": "Started Spotify playlist zip task"}
    else:
        task_ids = []
        for track in req.tracks:
            task_id = task_store.create_task(req.url, "audio", title=track.title)
            task_ids.append(task_id)
            
        background_tasks.add_task(_run_sequential_spotify_downloads, task_ids, req.tracks)
        return {"task_ids": task_ids, "message": f"Started {len(task_ids)} download tasks"}

def _run_sequential_spotify_downloads(task_ids: List[str], tracks: List[TrackItem]):
    import time
    for task_id, track in zip(task_ids, tracks):
        _process_single_spotify_track(task_id, track.youtube_url, track.title, track.spotify_metadata)
        time.sleep(5) # Delay to avoid HTTP 429 Too Many Requests

def _process_spotify_playlist_zip(task_id: str, title: str, tracks: List[TrackItem]):
    from backend.utils.file_utils import TEMP_DIR, DOWNLOADS_DIR, zip_directory
    import shutil
    import os
    import time

    task_store.update_task(task_id, status="downloading", progress=0.0)
    
    task_temp_dir = TEMP_DIR / task_id
    task_temp_dir.mkdir(parents=True, exist_ok=True)
    
    total = len(tracks)
    for idx, track in enumerate(tracks):
        task = task_store.get_task(task_id)
        if task and task.get("cancel_requested"):
             shutil.rmtree(task_temp_dir, ignore_errors=True)
             task_store.update_task(task_id, status="cancelled", progress=0.0, error="Download cancelled by user")
             return
             
        yt_url = track.youtube_url
        if not yt_url and track.spotify_metadata:
             from backend.services.youtube_matcher import get_best_match
             try:
                 match = get_best_match(track.spotify_metadata)
                 yt_url = match["youtube_url"]
             except Exception as e:
                 import logging
                 logging.getLogger(__name__).warning(f"Failed to find match for {track.title}: {e}")
                 
        if yt_url:
             import yt_dlp
             from backend.services.yt_dlp_service import _get_audio_opts
             opts = _get_audio_opts("best")
             clean_title = track.title.replace("/", "-").replace("\\", "-")
             opts['outtmpl'] = str(task_temp_dir / f"{clean_title}.%(ext)s")
             
             def progress_hook(d):
                 t_check = task_store.get_task(task_id)
                 if t_check and t_check.get("cancel_requested"):
                     raise Exception("Cancelled")
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
                         title=f"Downloading {idx+1}/{total}..."
                     )
             
             opts['progress_hooks'] = [progress_hook]
             
             try:
                 with yt_dlp.YoutubeDL(opts) as ydl:
                     ydl.download([yt_url])
             except Exception as e:
                 import logging
                 logging.getLogger(__name__).warning(f"Failed to download {yt_url}: {e}")
                 
        if idx < total - 1:
             time.sleep(5)
        
    task_store.update_task(task_id, status="converting", speed="Zipping...", eta="00:00")
    zip_path = DOWNLOADS_DIR / f"{task_id}.zip"
    zip_directory(task_temp_dir, zip_path)
    shutil.rmtree(task_temp_dir, ignore_errors=True)
    
    zip_final_name = f"{title}.zip"
    task_store.update_task(
        task_id, 
        status="completed", 
        progress=100.0, 
        filename=zip_final_name, 
        download_path=str(zip_path), 
        title=zip_final_name,
        speed="0 KB/s",
        eta="00:00"
    )


@router.get("/progress/{task_id}")
def get_spotify_progress(task_id: str):
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _process_single_spotify_track(task_id: str, yt_url: str, title: str, spotify_metadata: dict = None):
    """
    Background task to process a single Spotify track download using its matched YT url.
    """
    try:
        task_store.update_task(task_id, status="downloading", progress=5)
        
        if not yt_url and spotify_metadata:
            task_store.update_task(task_id, status="downloading", progress=10, title=f"Matching {title} on YouTube...")
            from backend.services.youtube_matcher import get_best_match
            try:
                match = get_best_match(spotify_metadata)
                yt_url = match["youtube_url"]
            except Exception as e:
                raise Exception(f"Failed to find match on YouTube: {e}")
                
        if not yt_url:
            raise Exception("No YouTube URL provided or matched.")
        
        import yt_dlp
        from backend.services.yt_dlp_service import _get_audio_opts
        import os
        
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
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(yt_url, download=True)
                filename = ydl.prepare_filename(info)
                # change ext to mp3 because of postprocessor
                final_filename = os.path.splitext(filename)[0] + ".mp3"
                
                # Try to rename the file to the Spotify title if they differ
                spotify_filename = f"{title}.mp3".replace('/', '-').replace('\\', '-')
                spotify_filepath = os.path.join("downloads", spotify_filename)
                
                if os.path.basename(final_filename) != spotify_filename and os.path.exists(final_filename):
                    os.rename(final_filename, spotify_filepath)
                    final_filename = spotify_filepath
                    
                success = True
        except Exception as inner_e:
            last_error = inner_e
            
        if not success:
            raise Exception(f"Download failed. Last error: {last_error}")
            
        task_store.update_task(
            task_id,
            status="completed",
            progress=100.0,
            filename=os.path.basename(final_filename),
            download_path=final_filename,
            title=title
        )
        
    except Exception as e:
        task_store.update_task(task_id, status="failed", error=str(e))

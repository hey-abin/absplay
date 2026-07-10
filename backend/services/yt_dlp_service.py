import os
import shutil
import yt_dlp
from pathlib import Path
from typing import Dict, Any, List, Optional
from backend.services.task_service import task_store
from backend.utils.file_utils import DOWNLOADS_DIR, TEMP_DIR, zip_directory
from backend.services.url_detector import detect_url_type

def _inject_cookies(opts: dict) -> dict:
    cookie_path = Path("cookies.txt")
    if cookie_path.exists():
        opts['cookiefile'] = str(cookie_path.absolute())
    return opts

class DownloadCancelledException(Exception):
    """Exception raised when the download is cancelled by the user."""
    pass

class SilentLogger:
    def debug(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass

def make_progress_hook(task_id: str, current_index: int, total_count: int):
    """Create a progress hook for yt-dlp downloads."""
    def hook(d):
        task = task_store.get_task(task_id)
        if not task:
            return
            
        # Check for cancellation
        if task.get("cancel_requested"):
            raise DownloadCancelledException("Download cancelled by user")

        if d['status'] == 'downloading':
            total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded_bytes = d.get('downloaded_bytes', 0)
            
            percent = 0.0
            if total_bytes > 0:
                percent = (downloaded_bytes / total_bytes) * 100.0
            else:
                percent_str = d.get('_percent_str', '0%').strip().replace('%', '')
                try:
                    percent = float(percent_str)
                except ValueError:
                    percent = 0.0

            # Scale progress based on multi-file processing
            overall_progress = ((current_index * 100.0) + percent) / total_count
            overall_progress = min(max(overall_progress, 0.0), 99.9)

            speed = d.get('_speed_str', 'N/A').strip()
            eta = d.get('_eta_str', 'N/A').strip()
            
            task_store.update_task(
                task_id,
                status="downloading",
                progress=overall_progress,
                speed=speed,
                eta=eta
            )
    return hook

def analyze_url(url: str) -> Dict[str, Any]:
    """Analyze the media URL and return its metadata."""
    url_info = detect_url_type(url)
    
    ydl_opts = _inject_cookies({
        'extract_flat': 'in_playlist',
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': ['player_client=ios,android']},
        'logger': SilentLogger()
    })
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception as e:
            raise ValueError(f"Failed to analyze URL: {str(e)}")
            
        if not info:
            raise ValueError("No metadata found for URL")

        is_playlist = info.get('_type') == 'playlist' or 'entries' in info
        
        # Override URL info's isPlaylist based on yt-dlp's actual extraction
        if is_playlist:
            url_info["isPlaylist"] = True
            if url_info["urlType"] == "youtube_video":
                url_info["urlType"] = "youtube_playlist"
            elif url_info["urlType"] == "youtube_music_track":
                url_info["urlType"] = "youtube_music_playlist"

        if is_playlist:
            entries = []
            raw_entries = info.get('entries', [])
            for idx, entry in enumerate(raw_entries):
                if entry:
                    entries.append({
                        "id": entry.get("id") or entry.get("url") or str(idx),
                        "title": entry.get("title") or f"Item #{idx+1}",
                        "duration": entry.get("duration"),
                        "thumbnail": entry.get("thumbnail"),
                        "index": idx
                    })
            return {
                "title": info.get("title") or "Playlist",
                "thumbnail": info.get("thumbnail") or (entries[0]["thumbnail"] if entries else None),
                "duration": sum(int(e["duration"]) for e in entries if e.get("duration")) if entries else 0,
                "creator": info.get("uploader") or info.get("uploader_id") or "Unknown Channel",
                "formats": [],
                "is_playlist": True,
                "playlist_entries": entries,
                **url_info
            }
        else:
            formats_raw = info.get("formats", [])
            formats_list = []
            seen_resolutions = set()
            
            for f in formats_raw:
                height = f.get("height")
                ext = f.get("ext") or "mp4"
                vcodec = f.get("vcodec")
                acodec = f.get("acodec")
                
                # Check for standard heights (1080p, 720p, 480p, 360p)
                if height and height in [360, 480, 720, 1080] and vcodec != 'none':
                    res_str = f"{height}p"
                    if res_str not in seen_resolutions:
                        seen_resolutions.add(res_str)
                        formats_list.append({
                            "format_id": f.get("format_id"),
                            "ext": ext,
                            "resolution": res_str,
                            "filesize": f.get("filesize"),
                            "note": f.get("format_note") or f.get("resolution"),
                            "fps": f.get("fps"),
                            "vcodec": vcodec,
                            "acodec": acodec
                        })
            
            # Sort formats by height (descending)
            formats_list.sort(key=lambda x: int(x["resolution"].replace("p", "")), reverse=True)
            
            return {
                "title": info.get("title") or "Video",
                "thumbnail": info.get("thumbnail"),
                "duration": info.get("duration"),
                "creator": info.get("uploader") or info.get("uploader_id") or "Unknown Creator",
                "formats": formats_list,
                "is_playlist": False,
                "playlist_entries": [],
                **url_info
            }

def _get_audio_opts(quality: str) -> dict:
    return _inject_cookies({
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192' if quality == '192kbps' else ('128' if quality == '128kbps' else '0'),
        }],
        'quiet': True,
        'no_warnings': True,
        'sleep_requests': 2.0,
        'sleep_interval': 3,
        'max_sleep_interval': 6,
        'extractor_args': {'youtube': ['player_client=ios,android']},
        'logger': SilentLogger()
    })

def _get_video_opts(quality: str) -> dict:
    ydl_opts = _inject_cookies({
        'format': 'best',
        'quiet': True,
        'no_warnings': True,
        'sleep_requests': 2.0,
        'sleep_interval': 3,
        'max_sleep_interval': 6,
        'extractor_args': {'youtube': ['player_client=ios,android']},
        'logger': SilentLogger()
    })
    if quality == "1080p":
        ydl_opts['format'] = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'
    elif quality == "720p":
        ydl_opts['format'] = 'bestvideo[height<=720]+bestaudio/best[height<=720]'
    elif quality == "480p":
        ydl_opts['format'] = 'bestvideo[height<=480]+bestaudio/best[height<=480]'
    elif quality == "360p":
        ydl_opts['format'] = 'bestvideo[height<=360]+bestaudio/best[height<=360]'
    else:
        ydl_opts['format'] = 'bestvideo+bestaudio/best'
    ydl_opts['merge_output_format'] = 'mp4'
    return ydl_opts

def _download_single(task_id: str, url: str, title: str, ydl_opts: dict):
    ydl_opts['outtmpl'] = str(DOWNLOADS_DIR / f"{task_id}.%(ext)s")
    ydl_opts['progress_hooks'] = [make_progress_hook(task_id, 0, 1)]
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
        
    downloaded_files = list(DOWNLOADS_DIR.glob(f"{task_id}.*"))
    if not downloaded_files:
        raise FileNotFoundError("Download completed but file could not be found.")
        
    final_file_path = downloaded_files[0]
    ext = final_file_path.suffix.replace(".", "")
    clean_filename = f"{title}.{ext}"
    
    task_store.update_task(
        task_id,
        status="completed",
        progress=100.0,
        speed="0 KB/s",
        eta="00:00",
        filename=clean_filename,
        download_path=str(final_file_path)
    )

def _download_playlist(task_id: str, title: str, meta: dict, ydl_opts: dict, selected_items: Optional[List[int]] = None):
    entries = list(meta.get("entries", []))
    download_indices = selected_items if selected_items is not None else list(range(len(entries)))
    
    if not download_indices:
        raise ValueError("No playlist items selected for download.")
        
    total_count = len(download_indices)
    task_temp_dir = TEMP_DIR / task_id
    task_temp_dir.mkdir(parents=True, exist_ok=True)
    
    import time
    for idx, entry_idx in enumerate(download_indices):
        task = task_store.get_task(task_id)
        if task and task.get("cancel_requested"):
            raise DownloadCancelledException("Download cancelled by user")
            
        entry = entries[entry_idx]
        if not entry:
            continue
            
        entry_url = entry.get("url") or entry.get("webpage_url")
        if not entry_url and entry.get("id"):
            entry_url = f"https://www.youtube.com/watch?v={entry['id']}"
            
        if not entry_url:
            continue
            
        entry_opts = dict(ydl_opts)
        entry_opts['outtmpl'] = str(task_temp_dir / "%(title)s.%(ext)s")
        entry_opts['progress_hooks'] = [make_progress_hook(task_id, idx, total_count)]
        
        with yt_dlp.YoutubeDL(entry_opts) as ydl:
            ydl.download([entry_url])
            
        # Add a short delay between every single video to prevent HTTP 403 Forbidden
        if idx < total_count - 1:
            time.sleep(5)
    
    task = task_store.get_task(task_id)
    if task and task.get("cancel_requested"):
        raise DownloadCancelledException("Download cancelled by user")
        
    task_store.update_task(task_id, status="converting", speed="Zipping...", eta="00:00")
    
    zip_filename = f"{task_id}.zip"
    zip_path = DOWNLOADS_DIR / zip_filename
    zip_directory(task_temp_dir, zip_path)
    
    shutil.rmtree(task_temp_dir, ignore_errors=True)
    
    zip_final_name = title if title.endswith(".zip") else f"{title}.zip"
        
    task_store.update_task(
        task_id,
        status="completed",
        progress=100.0,
        speed="0 KB/s",
        eta="00:00",
        filename=zip_final_name,
        download_path=str(zip_path)
    )

def _download_youtube_video(task_id: str, url: str, type_: str, quality: str, title: str):
    opts = _get_audio_opts(quality) if type_ == "audio" else _get_video_opts(quality)
    _download_single(task_id, url, title, opts)

def _download_youtube_playlist(task_id: str, type_: str, quality: str, title: str, meta: dict, selected_items: Optional[List[int]]):
    opts = _get_audio_opts(quality) if type_ == "audio" else _get_video_opts(quality)
    _download_playlist(task_id, title, meta, opts, selected_items)

def _download_music_track(task_id: str, url: str, quality: str, title: str):
    # Enforce audio-only
    opts = _get_audio_opts(quality)
    _download_single(task_id, url, title, opts)

def _download_music_playlist(task_id: str, quality: str, title: str, meta: dict, selected_items: Optional[List[int]]):
    # Enforce audio-only
    opts = _get_audio_opts(quality)
    _download_playlist(task_id, title, meta, opts, selected_items)

def run_download_task(task_id: str, url: str, type_: str, quality: str, selected_items: Optional[List[int]] = None):
    """Run the download job. Intended for background execution."""
    task_store.update_task(task_id, status="downloading", progress=0.0)
    
    try:
        url_info = detect_url_type(url)
        
        # 1. Fetch metadata first to get actual title and info
        ydl_opts_meta = _inject_cookies({
            'extract_flat': 'in_playlist',
            'skip_download': True,
            'quiet': True,
            'no_warnings': True,
            'logger': SilentLogger()
        })
        with yt_dlp.YoutubeDL(ydl_opts_meta) as ydl:
            meta = ydl.extract_info(url, download=False)
            
        title = meta.get("title") or "Media File"
        is_playlist = meta.get('_type') == 'playlist' or 'entries' in meta
        
        if is_playlist:
            url_info["isPlaylist"] = True
            if url_info["urlType"] == "youtube_video":
                url_info["urlType"] = "youtube_playlist"
            elif url_info["urlType"] == "youtube_music_track":
                url_info["urlType"] = "youtube_music_playlist"
                
            task_data = task_store.get_task(task_id)
            part_number = task_data.get("part_number", 0) if task_data else 0
            
            clean_title = title.replace("/", "-").replace("\\", "-")
            if part_number > 0:
                title = f"AbsPlay-{clean_title}-{part_number}.zip"
            else:
                title = f"AbsPlay-{clean_title}.zip"

        task_store.update_task(task_id, title=title)
        
        url_type = url_info["urlType"]
        
        # Dispatch to specific handlers based on URL type
        if url_type == "youtube_music_track":
            _download_music_track(task_id, url, quality, title)
        elif url_type == "youtube_music_playlist":
            _download_music_playlist(task_id, quality, title, meta, selected_items)
        elif url_type == "youtube_playlist":
            _download_youtube_playlist(task_id, type_, quality, title, meta, selected_items)
        else:
            _download_youtube_video(task_id, url, type_, quality, title)
            
    except DownloadCancelledException:
        # Clean up files for this task
        cleanup_task_files(task_id)
        task_store.update_task(
            task_id,
            status="cancelled",
            progress=0.0,
            speed="0 KB/s",
            eta="00:00",
            error="Download cancelled by user"
        )
    except Exception as e:
        # Clean up files for this task
        cleanup_task_files(task_id)
        task_store.update_task(
            task_id,
            status="failed",
            error=str(e)
        )

def cleanup_task_files(task_id: str):
    """Clean up any temporary or downloaded files associated with a task ID."""
    # Clean up temp folder
    temp_folder = TEMP_DIR / task_id
    if temp_folder.exists():
        shutil.rmtree(temp_folder, ignore_errors=True)
        
    # Clean up final download file/ZIP if it was created
    for f in DOWNLOADS_DIR.glob(f"{task_id}.*"):
        try:
            f.unlink()
        except FileNotFoundError:
            pass

def run_sequential_downloads(tasks: List[dict]):
    """
    Run multiple download tasks sequentially to avoid rate-limiting.
    tasks: [{"task_id": "...", "url": "...", "type_": "...", "quality": "...", "selected_items": [...]}]
    """
    import time
    for i, t in enumerate(tasks):
        run_download_task(
            task_id=t["task_id"],
            url=t["url"],
            type_=t["type_"],
            quality=t["quality"],
            selected_items=t["selected_items"]
        )
        # Sleep between tasks (except after the last one) to avoid HTTP 403 Forbidden
        if i < len(tasks) - 1:
            time.sleep(5)

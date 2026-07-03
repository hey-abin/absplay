import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, BackgroundTasks, status
from fastapi.responses import FileResponse
from backend.models.requests import DownloadRequest
from backend.models.responses import DownloadResponse, ProgressResponse
from backend.services.task_service import task_store
from backend.services.yt_dlp_service import run_download_task, run_sequential_downloads
from backend.utils.file_utils import cleanup_old_files

router = APIRouter(tags=["Downloads"])

@router.post("/download", response_model=DownloadResponse)
async def download(request: DownloadRequest, background_tasks: BackgroundTasks):
    """
    Initiate a background download for the given URL.
    Returns the task_ids to track progress.
    """
    if not request.url or not request.url.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL is required"
        )
        
    # Trigger a clean up of older files (e.g., older than 1 hour) in background
    background_tasks.add_task(cleanup_old_files, 3600)
    
    if request.type == "playlist" and request.selected_items and len(request.selected_items) > 10:
        task_ids = []
        tasks_to_run = []
        
        chunk_size = 10
        for i in range(0, len(request.selected_items), chunk_size):
            chunk = request.selected_items[i:i + chunk_size]
            part_number = (i // chunk_size) + 1
            task_id = task_store.create_task(
                request.url,
                request.type,
                quality=request.quality,
                selected_items=chunk,
                part_number=part_number
            )
            task_ids.append(task_id)
            tasks_to_run.append({
                "task_id": task_id,
                "url": request.url,
                "type_": request.type,
                "quality": request.quality,
                "selected_items": chunk
            })
            
        background_tasks.add_task(run_sequential_downloads, tasks_to_run)
        return {"task_ids": task_ids}
    else:
        # Register single task
        task_id = task_store.create_task(
            request.url,
            request.type,
            quality=request.quality,
            selected_items=request.selected_items
        )
        
        # Spawn background worker
        background_tasks.add_task(
            run_download_task,
            task_id=task_id,
            url=request.url,
            type_=request.type,
            quality=request.quality,
            selected_items=request.selected_items
        )
        
        return {"task_ids": [task_id]}

@router.get("/progress/{task_id}", response_model=ProgressResponse)
async def get_progress(task_id: str):
    """Get the current progress of a download task."""
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found"
        )
    return task

@router.delete("/cancel/{task_id}")
async def cancel_task(task_id: str):
    """Request cancellation of a running task."""
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found"
        )
        
    success = task_store.cancel_task(task_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not request cancellation"
        )
        
    return {"message": "Cancellation requested successfully", "task_id": task_id}

@router.get("/download/{task_id}")
async def serve_file(task_id: str):
    """Download the completed media file."""
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found"
        )
        
    if task["status"] != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task is not completed. Current status: {task['status']}"
        )
        
    download_path = task.get("download_path")
    if not download_path or not os.path.exists(download_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Completed file not found on disk"
        )
        
    return FileResponse(
        path=download_path,
        filename=task.get("filename") or "download",
        media_type="application/octet-stream"
    )

@router.post("/retry/{task_id}", response_model=DownloadResponse)
async def retry_task(task_id: str, background_tasks: BackgroundTasks):
    """Retry a failed or cancelled task."""
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found"
        )
        
    if task["status"] not in ["failed", "cancelled"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only failed or cancelled tasks can be retried"
        )
        
    # Reset task state in store
    task_store.update_task(
        task_id,
        status="pending",
        progress=0.0,
        speed="0 KB/s",
        eta="00:00",
        error=None,
        cancel_requested=False,
        title="Initializing..."
    )
    
    from backend.utils.url_parser import detect_url_type
    url_info = detect_url_type(task["url"])
    
    if url_info.get("isSpotify"):
        from backend.routes.spotify import _process_spotify_download
        from backend.routes.spotify import SpotifyDownloadRequest
        req = SpotifyDownloadRequest(url=task["url"], selected_items=task.get("selected_items"))
        background_tasks.add_task(_process_spotify_download, task_id, req)
    else:
        # Spawn background worker again
        background_tasks.add_task(
            run_download_task,
            task_id=task_id,
            url=task["url"],
            type_=task["type"],
            quality=task.get("quality", "1080p"),
            selected_items=task.get("selected_items")
        )
    
    return {"task_ids": [task_id]}

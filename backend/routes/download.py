import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, BackgroundTasks, status
from fastapi.responses import FileResponse
from backend.models.requests import DownloadRequest
from backend.models.responses import DownloadResponse, ProgressResponse
from backend.services.task_service import task_store
from backend.services.yt_dlp_service import run_download_task
from backend.utils.file_utils import cleanup_old_files

router = APIRouter(tags=["Downloads"])

@router.post("/download", response_model=DownloadResponse)
async def download(request: DownloadRequest, background_tasks: BackgroundTasks):
    """
    Initiate a background download for the given URL.
    Returns the task_id to track progress.
    """
    if not request.url or not request.url.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL is required"
        )
        
    # Trigger a clean up of older files (e.g., older than 1 hour) in background
    background_tasks.add_task(cleanup_old_files, 3600)
    
    # Register task in the store
    task_id = task_store.create_task(request.url, request.type)
    
    # Spawn background worker
    background_tasks.add_task(
        run_download_task,
        task_id=task_id,
        url=request.url,
        type_=request.type,
        quality=request.quality,
        selected_items=request.selected_items
    )
    
    return {"task_id": task_id}

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

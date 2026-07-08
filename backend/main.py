# pyrefly: ignore [missing-import]
import uvicorn
# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from backend.routes import analyze, download, spotify
import asyncio
from backend.utils.file_utils import ensure_dirs, cleanup_old_files

async def cleanup_loop():
    while True:
        try:
            # Delete files older than 30 minutes (1800 seconds)
            deleted = cleanup_old_files(max_age_seconds=1800)
            if deleted > 0:
                print(f"Auto-cleanup: Removed {deleted} old files/folders.")
        except Exception as e:
            print(f"Error in cleanup task: {e}")
        # Wait 5 minutes before checking again
        await asyncio.sleep(300)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure necessary folders exist
    ensure_dirs()
    # Start the background cleanup task
    task = asyncio.create_task(cleanup_loop())
    yield
    # Cancel the task on shutdown
    task.cancel()

app = FastAPI(
    title="Media Downloader API",
    description="Backend API for downloading media using yt-dlp",
    version="1.0.0",
    lifespan=lifespan
)

import os

# Configure CORS for production and local development
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
origins = [
    "http://localhost:5173",
    "https://localhost:5173",
    "http://localhost:3000",
    "https://localhost:3000",
    frontend_url
]
# Remove duplicates if any
origins = list(set(origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(analyze.router)
app.include_router(download.router)
app.include_router(spotify.router, prefix="/spotify", tags=["spotify"])

@app.get("/")
def health_check():
    """Health check endpoint to verify backend status."""
    return {"status": "ok", "message": "Media Downloader API is running"}

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)

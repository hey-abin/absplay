import sys
import traceback
from backend.services.yt_dlp_service import run_download_task

try:
    run_download_task("test_task", "https://music.youtube.com/playlist?list=PLGkXt7lYySug&si=gnlZZvQPg1vgzkFV", "audio", "Best Available", [0])
except Exception as e:
    traceback.print_exc()

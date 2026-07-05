import traceback
from backend.services.yt_dlp_service import run_download_task

try:
    # chunk 1 is items 0 to 9
    run_download_task("test_task_chunk1", "https://music.youtube.com/playlist?list=PLGkXt7lYySug&si=gnlZZvQPg1vgzkFV", "audio", "Best Available", list(range(10)))
except Exception as e:
    traceback.print_exc()

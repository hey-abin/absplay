import os
import shutil
import time
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
TEMP_DIR = BASE_DIR / "temp"

def ensure_dirs():
    """Ensure that the downloads and temp directories exist."""
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

def zip_directory(directory_path: Path, zip_file_path: Path) -> None:
    """Zip all contents of a directory into a single zip file."""
    directory_path = Path(directory_path)
    zip_file_path = Path(zip_file_path)
    
    with zipfile.ZipFile(zip_file_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(directory_path):
            for file in files:
                file_path = Path(root) / file
                # Keep relative structure inside the zip
                arcname = file_path.relative_to(directory_path)
                zipf.write(file_path, arcname)

def cleanup_old_files(max_age_seconds: int = 3600) -> int:
    """
    Cleans up files in downloads and temp directories that are older than max_age_seconds.
    Returns the number of items deleted.
    """
    ensure_dirs()
    now = time.time()
    deleted_count = 0
    
    for directory in [DOWNLOADS_DIR, TEMP_DIR]:
        for root, dirs, files in os.walk(directory, topdown=False):
            # Delete files older than max_age_seconds
            for file in files:
                file_path = Path(root) / file
                try:
                    if now - file_path.stat().st_mtime > max_age_seconds:
                        file_path.unlink()
                        deleted_count += 1
                except FileNotFoundError:
                    pass
                except Exception as e:
                    print(f"Error deleting file {file_path}: {e}")
            
            # Delete empty subdirectories (except top-level directories)
            for d in dirs:
                dir_path = Path(root) / d
                try:
                    if not os.listdir(dir_path):
                        dir_path.rmdir()
                        deleted_count += 1
                except Exception as e:
                    print(f"Error deleting directory {dir_path}: {e}")
                    
    return deleted_count

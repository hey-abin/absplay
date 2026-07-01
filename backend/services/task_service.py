import threading
import uuid
from typing import Dict, Any, Optional

class TaskStore:
    def __init__(self):
        self._tasks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def create_task(self, url: str, type_: str) -> str:
        task_id = str(uuid.uuid4())
        with self._lock:
            self._tasks[task_id] = {
                "task_id": task_id,
                "url": url,
                "type": type_,
                "status": "pending",
                "progress": 0.0,
                "speed": "0 KB/s",
                "eta": "00:00",
                "error": None,
                "filename": None,
                "title": "Initializing...",
                "download_path": None,
                "cancel_requested": False
            }
        return task_id

    def update_task(self, task_id: str, **kwargs) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].update(kwargs)

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task:
                return dict(task)
            return None

    def cancel_task(self, task_id: str) -> bool:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id]["cancel_requested"] = True
                return True
            return False

    def get_all_tasks(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {k: dict(v) for k, v in self._tasks.items()}

# Global instance of task store
task_store = TaskStore()

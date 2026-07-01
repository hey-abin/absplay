import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
from backend.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "message": "Media Downloader API is running"}

@patch('backend.routes.analyze.analyze_url')
def test_analyze_endpoint(mock_analyze):
    mock_analyze.return_value = {
        "title": "Mock Video",
        "thumbnail": "http://example.com/thumb.jpg",
        "duration": 120,
        "creator": "Mock Creator",
        "formats": [
            {
                "format_id": "18",
                "ext": "mp4",
                "resolution": "360p",
                "filesize": 1024,
                "note": "medium",
                "fps": 30.0,
                "vcodec": "h264",
                "acodec": "aac"
            }
        ],
        "is_playlist": False,
        "playlist_entries": []
    }
    
    response = client.post("/analyze", json={"url": "https://www.youtube.com/watch?v=mock"})
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Mock Video"
    assert data["formats"][0]["resolution"] == "360p"

def test_download_and_progress_flow():
    # We patch run_download_task to avoid running the actual download in background
    with patch('backend.routes.download.run_download_task') as mock_run:
        response = client.post("/download", json={
            "url": "https://www.youtube.com/watch?v=mock",
            "type": "video",
            "quality": "720p"
        })
        assert response.status_code == 200
        task_id = response.json()["task_id"]
        assert task_id is not None
        
        # Test progress endpoint
        response = client.get(f"/progress/{task_id}")
        assert response.status_code == 200
        progress_data = response.json()
        assert progress_data["status"] == "pending"
        
        # Test cancel endpoint
        response = client.delete(f"/cancel/{task_id}")
        assert response.status_code == 200
        assert response.json()["message"] == "Cancellation requested successfully"

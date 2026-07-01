# Media Downloader - REST API Reference

The Media Downloader Backend is a FastAPI service that performs media analysis, background downloading, progress monitoring, and file retrieval.

- **Base URL**: `http://localhost:8000`
- **Default Headers**: `Content-Type: application/json`

---

## 🧭 Endpoints Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/` | Service health status |
| **POST** | `/analyze` | Analyze a media URL & fetch metadata |
| **POST** | `/download` | Trigger a background media download |
| **GET** | `/progress/{task_id}` | Fetch current progress of a download |
| **GET** | `/download/{task_id}` | Retrieve the completed file/ZIP |
| **DELETE** | `/cancel/{task_id}` | Cancel an active downloading task |

---

## 📝 API Details

### 1. Health Status
Returns the server status to verify API connection.

- **Request**: `GET /`
- **Response** (`200 OK`):
  ```json
  {
    "status": "ok",
    "message": "Media Downloader API is running"
  }
  ```

---

### 2. URL Metadata Analysis
Analyze the video or playlist and fetch formats/items.

- **Request**: `POST /analyze`
- **Payload**:
  ```json
  {
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }
  ```
- **Response** (`200 OK` - Single Video):
  ```json
  {
    "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    "duration": 212,
    "creator": "Rick Astley",
    "is_playlist": false,
    "formats": [
      {
        "format_id": "137",
        "ext": "mp4",
        "resolution": "1080p",
        "filesize": 4519203,
        "note": "1080p",
        "fps": 30.0,
        "vcodec": "av01.0.08M.08",
        "acodec": "none"
      }
    ],
    "playlist_entries": []
  }
  ```
- **Response** (`200 OK` - Playlist):
  ```json
  {
    "title": "Rick Astley Hits",
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "duration": 636,
    "creator": "RickAstleyVEVO",
    "is_playlist": true,
    "formats": [],
    "playlist_entries": [
      {
        "id": "dQw4w9WgXcQ",
        "title": "Never Gonna Give You Up",
        "duration": 212,
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        "index": 0
      }
    ]
  }
  ```

---

### 3. Initiate Background Download
Trigger a background download task. Returns a unique UUID `task_id` for polling.

- **Request**: `POST /download`
- **Payload** (Single Video as MP4):
  ```json
  {
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "type": "video",
    "quality": "1080p"
  }
  ```
- **Payload** (Playlist items as MP3 Audio):
  ```json
  {
    "url": "https://www.youtube.com/playlist?list=PL...",
    "type": "playlist",
    "quality": "192kbps",
    "selected_items": [0, 2, 5]
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "task_id": "8a7c6422-9214-4113-90d5-cb663ea47c21"
  }
  ```

---

### 4. Fetch Download Progress
Retrieve real-time stats of the current task.

- **Request**: `GET /progress/{task_id}`
- **Response** (`200 OK`):
  ```json
  {
    "task_id": "8a7c6422-9214-4113-90d5-cb663ea47c21",
    "status": "downloading",
    "progress": 42.5,
    "speed": "2.4 MB/s",
    "eta": "00:12",
    "error": null,
    "filename": "Rick Astley - Never Gonna Give You Up.mp4",
    "title": "Never Gonna Give You Up"
  }
  ```
- **Statuses**:
  - `pending`: Download initialization.
  - `downloading`: Fetching fragments from source.
  - `converting`: Post-processing codecs/extracting audio/creating ZIP files.
  - `completed`: Ready for download.
  - `failed`: Finished with error.
  - `cancelled`: Cancelled by user.

---

### 5. Download Completed File
Serve the file or zipped bundle. Triggers standard browser downloader.

- **Request**: `GET /download/{task_id}`
- **Response** (`200 OK`):
  - Streams binary file stream of the media.
  - Set `Content-Disposition` header with the video's friendly filename.

---

### 6. Cancel Running Task
Terminate an active downloader task and purge all incomplete files from cache directories.

- **Request**: `DELETE /cancel/{task_id}`
- **Response** (`200 OK`):
  ```json
  {
    "message": "Cancellation requested successfully",
    "task_id": "8a7c6422-9214-4113-90d5-cb663ea47c21"
  }
  ```

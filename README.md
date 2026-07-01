# Media Downloader - Educational Full-Stack Web Application

A modern full-stack web application designed to demonstrate python backend service architecture, asynchronous media processing APIs, progress hooks tracking, and custom zipping packaging workflows.

The application allows users to paste media URLs from 1000+ popular platforms, inspect titles/channels/formats, choose custom resolutions (up to 1080p) or bitrates (for MP3 extraction), customize selection of playlist items, and monitor background download tasks in real-time.

---

## ⚡ Technology Stack

### Backend
- **Python 3.14+**
- **FastAPI** (Async endpoint handling & BackgroundTasks)
- **yt-dlp** (Media extraction & downloading)
- **FFmpeg** (Audio conversion and format merging)
- **Pytest** (Automated testing suite)

### Frontend
- **Next.js 16 (App Router)**
- **React 19**
- **Tailwind CSS v4** (Aesthetic dark mode and modern glassmorphism UI)
- **HTML5 & Vanilla JavaScript**

---

## 📂 Project Directory Structure

```text
/Users/Abin/Documents/yt-dl/
├── README.md               # Main instructions & overview
├── PROJECT_REQUIREMENTS.md # Original user specifications
├── docs/
│   └── api.md              # REST API Reference manual
├── backend/
│   ├── main.py             # FastAPI App Entrypoint
│   ├── requirements.txt    # Python requirements
│   ├── routes/             # Endpoint routing modules
│   │   ├── analyze.py      # Meta analysis endpoint
│   │   └── download.py     # Download, progress, cancel, file serving
│   ├── services/           # Service layer classes
│   │   ├── task_service.py   # In-memory thread-safe TaskStore
│   │   └── yt_dlp_service.py # yt-dlp integrations & hooks
│   ├── utils/              # Utility helpers
│   │   └── file_utils.py   # Dir setup, ZIP zip, file cleanups
│   ├── downloads/          # Download target folder (contains active files)
│   └── temp/               # Temporary downloads folder (playlist chapters)
└── frontend/
    ├── src/
    │   └── app/
    │       ├── globals.css # Styling, scrollbar, animation themes
    │       ├── layout.js   # HTML head, typography, SEO metadata
    │       └── page.js     # Responsive single-page client app
    ├── package.json        # Node requirements & scripts
    └── tailwind.config.js  # Tailwind theme properties
```

---

## ⚙️ Local Development Setup

### System Prerequisites
Ensure **FFmpeg** and **FFprobe** are installed on your machine.
- **macOS**: `brew install ffmpeg`
- **Linux**: `sudo apt install ffmpeg`
- **Windows**: Install via scoop/choco or download binary from ffmpeg.org and add to PATH.

### 1. Backend Setup

1. **Navigate to backend and create a Virtual Environment**:
   ```bash
   python3 -m venv backend/.venv
   source backend/.venv/bin/activate
   ```
2. **Install dependencies**:
   ```bash
   pip install -r backend/requirements.txt
   ```
3. **Start the API Server**:
   ```bash
   python backend/main.py
   ```
   The backend API will run at `http://localhost:8000`.

4. **Run Backend Tests**:
   ```bash
   PYTHONPATH=. backend/.venv/bin/pytest backend/tests/
   ```

### 2. Frontend Setup

1. **Install node modules**:
   ```bash
   cd frontend
   npm install
   ```
2. **Start the Dev Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your web browser.

---

## 📖 Features Walkthrough

1. **Instant Analysis**: Enter a link and click **Analyze Media URL**. The server fetches video metadata without downloading it.
2. **Download Options**:
   - **Video**: Select height constraints (1080p, 720p, 480p, 360p, or Best Available).
   - **Audio**: Extract audio as a high quality MP3 (128kbps, 192kbps, or Best Bitrate).
3. **Playlist Download Selection**:
   - View a complete list of entries.
   - Choose which items to download or exclude.
   - Click **Download** to package all selected items inside a single ZIP archive automatically.
4. **Active Dashboard Polling**: Renders progress bars, current download speed, and estimated time remaining (ETA). The cancel button lets users terminate active tasks instantly.
5. **Local Storage History**: Keeps track of previous downloads, dates, and names in your local browser history with options to delete logs or redownload.

# Media Downloader - Project Requirements

## 1. Project Overview

### Project Name

Media Downloader

### Purpose

Build a modern full-stack web application for educational purposes that
demonstrates backend architecture, media processing, REST APIs,
background jobs, and file handling. The application should analyze
supported media URLs, present metadata, and process user-requested
downloads.

------------------------------------------------------------------------

# 2. Technology Stack

## Frontend

-   Next.js (App Router)
-   React
-   Tailwind CSS
-   JavaScript
-   Responsive Design

## Backend

-   Python
-   FastAPI
-   Uvicorn
-   yt-dlp
-   FFmpeg

------------------------------------------------------------------------

# 3. Project Structure

``` text
media-downloader/
│
├── docs/
├── frontend/
├── backend/
│   ├── main.py
│   ├── routes/
│   ├── services/
│   ├── models/
│   ├── utils/
│   ├── downloads/
│   ├── temp/
│   └── requirements.txt
└── README.md
```

------------------------------------------------------------------------

# 4. Core Features

## Home Page

-   Modern landing page
-   URL input
-   Analyze button
-   Download button
-   Feature cards
-   FAQ
-   Footer

## URL Analysis

Return: - Title - Thumbnail - Duration - Creator/Channel - Available
formats - Playlist details (when applicable)

## Download Options

Video: - MP4 - 360p - 480p - 720p - 1080p - Best available

Audio: - MP3 - 128 kbps - 192 kbps - Best available

Playlist: - Entire playlist - Selected items - Audio only - Video only -
ZIP archive after processing

------------------------------------------------------------------------

# 5. Backend API

## GET /

Health check

## POST /analyze

Analyze URL and return metadata.

## POST /download

Start a download task.

## GET /progress/{task_id}

Return task progress.

## GET /download/{task_id}

Return completed file.

## DELETE /cancel/{task_id}

Cancel a running task.

------------------------------------------------------------------------

# 6. Backend Requirements

-   FastAPI
-   Async endpoints where appropriate
-   Pydantic models
-   BackgroundTasks
-   StreamingResponse
-   Logging
-   Temporary file cleanup
-   Environment variables
-   Modular service layer
-   Proper exception handling

------------------------------------------------------------------------

# 7. Frontend Requirements

-   Responsive UI
-   Dark/Light mode
-   Progress bar
-   Toast notifications
-   Thumbnail preview
-   Download history (local storage)
-   Loading skeletons

------------------------------------------------------------------------

# 8. Error Handling

Handle gracefully: - Invalid URLs - Unsupported URLs - Network
failures - Conversion failures - Missing FFmpeg - Internal server errors

------------------------------------------------------------------------

# 9. Documentation

Include: - README.md - Installation guide - Environment variables - API
documentation - Local development setup - Deployment guide

------------------------------------------------------------------------

# 10. Development Roadmap

Phase 1 - Project setup - FastAPI - Next.js

Phase 2 - URL analysis

Phase 3 - Single media download

Phase 4 - Playlist support

Phase 5 - Progress tracking

Phase 6 - ZIP packaging

Phase 7 - UI polish

Phase 8 - Testing

Phase 9 - Deployment

------------------------------------------------------------------------

# 11. Coding Standards

-   Clean architecture
-   Reusable components
-   Well-documented code
-   Modular services
-   Consistent naming
-   Production-ready quality

------------------------------------------------------------------------

# Instructions for AI Coding Agent

Read this document completely before generating code.

Treat this file as the project's source of truth.

Before writing any code: 1. Generate the folder structure. 2. Explain
the implementation plan. 3. Build one feature at a time. 4. Ensure each
feature is fully functional before moving to the next. 5. Avoid
placeholder implementations. 6. Keep the code clean, modular, and
scalable.

FROM python:3.11-slim

# Install FFmpeg (required for yt-dlp)
RUN apt-get update && \
    apt-get install -y ffmpeg nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend source code
COPY backend/ ./backend/
# Copy cookies file if it exists in the root directory (the * prevents failure if missing)
COPY cookies.txt* ./

# Expose port (Railway will override this via $PORT)
EXPOSE 8000

# Set default port
ENV PORT=8000

# Run the FastAPI application
CMD sh -c "uvicorn backend.main:app --host 0.0.0.0 --port $PORT"

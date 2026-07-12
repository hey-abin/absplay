import yt_dlp
from pathlib import Path

cookie_path = Path("/Users/Abin/Documents/yt-dl/cookies.txt")
opts = {
    'cookiefile': str(cookie_path),
    'extractor_args': {'youtube': ['player_client=ios,android']},
    'quiet': False
}
with yt_dlp.YoutubeDL(opts) as ydl:
    ydl.extract_info('https://www.youtube.com/watch?v=dQw4w9WgXcQ', download=False)

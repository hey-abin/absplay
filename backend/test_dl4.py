import yt_dlp
from pathlib import Path

cookie_path = Path("/Users/Abin/Documents/yt-dl/cookies.txt")
opts = {
    'cookiefile': str(cookie_path),
    'extractor_args': {'youtube': ['player_client=tv']},
    'format': 'bestaudio/best',
    'quiet': False
}
with yt_dlp.YoutubeDL(opts) as ydl:
    ydl.extract_info('ytsearch1:"Engotta - From Balan - The Boy"', download=True)

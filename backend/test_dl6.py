import yt_dlp
from pathlib import Path

# Use the disabled cookies file for testing
cookie_path = Path("/Users/Abin/Documents/yt-dl/cookies.txt.disabled")
opts = {
    'cookiefile': str(cookie_path),
    'format': 'bestaudio/best',
    'quiet': False
}
with yt_dlp.YoutubeDL(opts) as ydl:
    ydl.extract_info('ytsearch1:"Engotta - From Balan - The Boy"', download=True)

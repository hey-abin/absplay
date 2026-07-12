import yt_dlp

opts = {
    'extractor_args': {'youtube': ['player_client=ios,android']},
    'format': 'bestaudio/best',
    'quiet': False
}
with yt_dlp.YoutubeDL(opts) as ydl:
    ydl.extract_info('ytsearch1:"Engotta - From Balan - The Boy"', download=True)

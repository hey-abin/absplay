import re
from urllib.parse import urlparse, parse_qs
from typing import Dict, Any

def detect_url_type(url: str) -> Dict[str, Any]:
    """
    Categorizes the given URL into a specific type to determine how it should be handled.
    
    Returns:
        dict: A dictionary containing the URL context flags.
    """
    parsed_url = urlparse(url)
    hostname = parsed_url.hostname or ""
    path = parsed_url.path or ""
    query = parse_qs(parsed_url.query)

    is_music = "music.youtube.com" in hostname
    is_spotify = "spotify.com" in hostname
    is_playlist = False
    url_type = "youtube_video"

    if is_spotify:
        if "playlist" in path:
            url_type = "spotify_playlist"
            is_playlist = True
        else:
            url_type = "spotify_track"
        
        return {
            "urlType": url_type,
            "isMusic": True,
            "isPlaylist": is_playlist,
            "supportsVideo": False,
            "supportsAudio": True,
            "isSpotify": True
        }

    if is_music:
        if "playlist" in path or ("watch" in path and "list" in query):
            url_type = "youtube_music_playlist"
            is_playlist = True
        else:
            url_type = "youtube_music_track"
    else:
        # Standard YouTube or fallback
        if "playlist" in path or ("watch" in path and "list" in query):
            url_type = "youtube_playlist"
            is_playlist = True
        else:
            url_type = "youtube_video"

    return {
        "urlType": url_type,
        "isMusic": is_music,
        "isPlaylist": is_playlist,
        "supportsVideo": not is_music,
        "supportsAudio": True
    }

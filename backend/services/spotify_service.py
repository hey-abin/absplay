import re
import json
import urllib.request
import ssl
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)

def _fetch_embed_data(url: str, type_: str) -> Dict[str, Any]:
    """Scrape the Spotify embed widget to extract track/playlist metadata without API keys."""
    match = re.search(rf'spotify\.com/{type_}/([a-zA-Z0-9]+)', url)
    if not match:
        raise ValueError(f"Invalid Spotify {type_} URL")
    
    entity_id = match.group(1)
    embed_url = f"https://open.spotify.com/embed/{type_}/{entity_id}"
    
    try:
        # Ignore SSL errors just in case local certificates are missing
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        req = urllib.request.Request(embed_url, headers={'User-Agent': 'Mozilla/5.0'})
        html = urllib.request.urlopen(req, context=ctx).read().decode('utf-8')
        
        json_match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.+?)</script>', html)
        if not json_match:
            raise ValueError("Could not find metadata payload in Spotify embed page.")
            
        data = json.loads(json_match.group(1))
        entity = data['props']['pageProps']['state']['data']['entity']
        return entity
        
    except Exception as e:
        logger.error(f"Error scraping Spotify embed for {entity_id}: {e}")
        raise ValueError(f"Failed to fetch metadata from Spotify: {e}")

def get_track_metadata(url: str) -> Dict[str, Any]:
    """Retrieve metadata for a single Spotify track."""
    entity = _fetch_embed_data(url, "track")
    
    # Extract artists
    artists = [artist['name'] for artist in entity.get('artists', [])]
    artist_str = ", ".join(artists) if artists else "Unknown Artist"
    
    # Extract artwork
    artwork = ""
    visual_images = entity.get('visualIdentity', {}).get('image', [])
    if visual_images:
        artwork = visual_images[0].get('url', '')
        
    return {
        "title": entity.get('name', 'Unknown Title'),
        "artist": artist_str,
        "artists": artists,
        "album": "Unknown Album",  # The embed data for tracks might not have album name readily available
        "duration": entity.get('duration', 0),
        "duration_sec": entity.get('duration', 0) // 1000,
        "artwork": artwork,
        "track_number": 1,
        "spotify_url": f"https://open.spotify.com/track/{entity.get('id')}",
        "id": entity.get('id')
    }

def get_playlist_metadata(url: str) -> Dict[str, Any]:
    """Retrieve metadata for a Spotify playlist and all its tracks."""
    entity = _fetch_embed_data(url, "playlist")
    
    # Extract playlist artwork
    artwork = ""
    visual_images = entity.get('visualIdentity', {}).get('image', [])
    if visual_images:
        artwork = visual_images[0].get('url', '')
        
    tracks = []
    
    for idx, track in enumerate(entity.get('trackList', [])):
        # track subtitle is the artist
        artist_str = track.get('subtitle', 'Unknown Artist')
        artists = [artist_str]  # simplified for playlist
        
        tracks.append({
            "title": track.get('title', 'Unknown Title'),
            "artist": artist_str,
            "artists": artists,
            "album": "Unknown",
            "duration": track.get('duration', 0),
            "duration_sec": track.get('duration', 0) // 1000,
            "artwork": "", # Track artwork usually not present in playlist embed tracklist
            "track_number": idx + 1,
            "spotify_url": track.get('uri', '').replace('spotify:', 'https://open.spotify.com/').replace(':', '/'),
            "id": track.get('uid', str(idx)),
            "index": idx
        })
        
    return {
        "title": entity.get('name', 'Unknown Playlist'),
        "artwork": artwork,
        "total_tracks": len(tracks),
        "owner": "Spotify",
        "tracks": tracks,
        "spotify_url": f"https://open.spotify.com/playlist/{entity.get('id')}",
        "id": entity.get('id')
    }

def generate_search_queries(track_metadata: Dict[str, Any]) -> List[str]:
    """Generate prioritized search queries for YouTube matching."""
    title = track_metadata['title']
    artist = track_metadata['artists'][0] if track_metadata['artists'] else ""
    
    queries = []
    if artist:
        queries.append(f"{title} {artist} Official Audio")
        queries.append(f"{title} {artist}")
        queries.append(f"{artist} {title}")
    
    queries.append(title)
    
    return queries

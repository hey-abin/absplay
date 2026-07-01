import yt_dlp
# pyrefly: ignore [missing-import]
from rapidfuzz import fuzz
from typing import Dict, Any, List
import logging
from backend.services.spotify_service import generate_search_queries

logger = logging.getLogger(__name__)

# Known official strings for channel bonuses
OFFICIAL_KEYWORDS = ["official", "vevo", "topic"]

def search_youtube(query: str) -> List[Dict[str, Any]]:
    """Search YouTube for a specific query and return top 10 results."""
    ydl_opts = {
        'extract_flat': 'in_playlist',
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': ['player_client=default,ios,android']}
    }
    
    # ytsearch10: retrieves up to 10 results
    search_url = f"ytsearch10:{query}"
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(search_url, download=False)
            if 'entries' in info:
                return list(info['entries'])
            return []
        except Exception as e:
            logger.error(f"Error searching YouTube for '{query}': {e}")
            return []

def score_match(yt_result: Dict[str, Any], track_metadata: Dict[str, Any]) -> float:
    """
    Score a single YouTube result against Spotify metadata.
    * Title similarity -> 50%
    * Artist similarity -> 25%
    * Duration similarity -> 20%
    * Official channel bonus -> 5%
    """
    yt_title = yt_result.get('title', '').lower()
    yt_channel = yt_result.get('channel', yt_result.get('uploader', '')).lower()
    yt_duration = yt_result.get('duration', 0)
    
    sp_title = track_metadata['title'].lower()
    sp_artists = [a.lower() for a in track_metadata['artists']]
    sp_artist_main = sp_artists[0] if sp_artists else ""
    sp_duration = track_metadata['duration_sec']
    
    # 1. Title Similarity (0 - 50 points)
    # Using partial_ratio handles cases where YouTube title has extra info like "(Official Video)"
    title_score = fuzz.partial_ratio(sp_title, yt_title) * 0.5
    
    # 2. Artist Similarity (0 - 25 points)
    # Check if artist is in title or channel name
    artist_in_title = fuzz.partial_ratio(sp_artist_main, yt_title)
    artist_in_channel = fuzz.partial_ratio(sp_artist_main, yt_channel)
    artist_score = max(artist_in_title, artist_in_channel) * 0.25
    
    # 3. Duration Similarity (0 - 20 points)
    duration_score = 0
    if yt_duration and sp_duration:
        diff = abs(yt_duration - sp_duration)
        if diff <= 2:
            duration_score = 20
        elif diff <= 5:
            duration_score = 15
        elif diff <= 10:
            duration_score = 10
        elif diff <= 20:
            duration_score = 5
    else:
        duration_score = 10 # Neutral fallback if missing
        
    # 4. Official Channel Bonus (0 - 5 points)
    official_score = 0
    if any(keyword in yt_channel for keyword in OFFICIAL_KEYWORDS) or "official" in yt_title:
        official_score = 5
        
    total_score = title_score + artist_score + duration_score + official_score
    return min(100.0, total_score)

def get_all_matches(track_metadata: Dict[str, Any], min_score: float = 40.0) -> List[Dict[str, Any]]:
    """Find all viable YouTube matches for a Spotify track, sorted by confidence."""
    queries = generate_search_queries(track_metadata)
    
    all_scored = []
    seen_ids = set()
    
    for query in queries:
        results = search_youtube(query)
        found_perfect = False
        
        for res in results:
            vid_id = res.get('id') or res.get('url')
            if not vid_id or vid_id in seen_ids:
                continue
                
            seen_ids.add(vid_id)
            score = score_match(res, track_metadata)
            
            if score >= min_score:
                yt_id = res.get('id')
                yt_url = f"https://www.youtube.com/watch?v={yt_id}" if yt_id else res.get('url')
                all_scored.append({
                    "youtube_url": yt_url,
                    "title": res.get('title'),
                    "channel": res.get('channel', res.get('uploader')),
                    "duration": res.get('duration'),
                    "thumbnail": res.get('thumbnail') or (res.get('thumbnails', [{}])[0].get('url')),
                    "confidence_score": round(score, 1)
                })
                
                if score >= 90.0:
                    found_perfect = True
                    
        # If we found a highly confident match, no need to execute fallback queries
        if found_perfect:
            break
            
    all_scored.sort(key=lambda x: x["confidence_score"], reverse=True)
    if not all_scored:
        raise ValueError(f"No suitable YouTube match found for '{track_metadata['title']}'")
        
    return all_scored

def get_best_match(track_metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Find the best YouTube match for a Spotify track."""
    return get_all_matches(track_metadata)[0]

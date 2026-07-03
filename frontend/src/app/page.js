'use client';

import React, { useState, useEffect, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [mediaInfo, setMediaInfo] = useState(null);
  const [error, setError] = useState(null);
  
  // Playlist selection
  const [selectedItems, setSelectedItems] = useState([]);
  
  // Download options
  const [downloadType, setDownloadType] = useState('video'); // 'video' | 'audio'
  const [videoQuality, setVideoQuality] = useState('best');
  const [audioQuality, setAudioQuality] = useState('best');
  
  // Tasks and history
  const [activeTasks, setActiveTasks] = useState({});
  const [history, setHistory] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedHistory = localStorage.getItem('download_history');
      if (savedHistory) {
        try {
          return JSON.parse(savedHistory);
        } catch (e) {
          console.error(e);
        }
      }
    }
    return [];
  });
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      return savedTheme !== 'light';
    }
    return true;
  });
  
  // Backend health status
  const [backendUp, setBackendUp] = useState(false);
  
  // Toast notifications
  const [toasts, setToasts] = useState([]);
  
  const pollingIntervals = useRef({});
  const toastIdRef = useRef(0);

  // Check backend health on mount and setup polling
  useEffect(() => {
    const checkBackendHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/`);
        setBackendUp(res.ok);
      } catch {
        setBackendUp(false);
      }
    };

    checkBackendHealth();
    const healthInterval = setInterval(checkBackendHealth, 10000);
    
    const activeIntervals = pollingIntervals.current;
    return () => {
      clearInterval(healthInterval);
      // Clean up all active polling intervals on unmount
      Object.values(activeIntervals).forEach(clearInterval);
    };
  }, []);

  // Save history to localstorage on update
  useEffect(() => {
    localStorage.setItem('download_history', JSON.stringify(history));
  }, [history]);

  // Save theme preference to localstorage
  useEffect(() => {
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const showToast = (message, type = 'success') => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      showToast("URL Pasted", "info");
    } catch {
      showToast("Failed to read clipboard. Please paste manually.", "error");
    }
  };

  const handleAnalyze = async (e) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("Please enter a valid URL");
      return;
    }
    
    setAnalyzing(true);
    setError(null);
    setMediaInfo(null);
    setSelectedItems([]);
    
    try {
      const isSpotify = url.includes('spotify.com');
      const endpoint = isSpotify ? '/spotify/analyze' : '/analyze';
      
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to analyze URL");
      }
      
      setMediaInfo(data);
      const entries = data.playlist_entries || data.tracks;
      if (data.is_playlist && entries) {
        // By default, select all playlist items
        setSelectedItems(entries.map(item => item.index));
      }
      if (data.supportsVideo === false) {
        setDownloadType('audio');
      } else {
        setDownloadType('video');
      }
      showToast("Analysis Completed");
    } catch (err) {
      setError(err.message || "An unexpected error occurred");
      showToast(err.message || "Analysis failed", "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const triggerFileDownload = (taskId, filename) => {
    const downloadUrl = `${API_BASE}/download/${taskId}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', filename || 'media_file');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Downloading: ${filename || 'media file'}`);
  };

  const addToHistory = (task) => {
    setHistory(prev => {
      // Prevent duplicates
      if (prev.some(item => item.task_id === task.task_id)) return prev;
      return [
        {
          task_id: task.task_id,
          title: task.title || 'Unknown Media',
          filename: task.filename || 'download',
          type: task.type || 'video',
          date: new Date().toLocaleString(),
          url: task.url
        },
        ...prev
      ];
    });
  };

  const startPolling = (taskId) => {
    if (pollingIntervals.current[taskId]) return;
    
    pollingIntervals.current[taskId] = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/progress/${taskId}`);
        if (!res.ok) throw new Error("Progress status fetch failed");
        
        const data = await res.json();
        
        setActiveTasks(prev => ({
          ...prev,
          [taskId]: data
        }));

        if (['completed', 'failed', 'cancelled'].includes(data.status)) {
          clearInterval(pollingIntervals.current[taskId]);
          delete pollingIntervals.current[taskId];
          
          if (data.status === 'completed') {
            triggerFileDownload(taskId, data.filename);
            addToHistory(data);
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
        clearInterval(pollingIntervals.current[taskId]);
        delete pollingIntervals.current[taskId];
      }
    }, 1000);
  };

  const handleSingleItemDownload = async (item, e) => {
    if (e) e.stopPropagation();
    
    let singleUrl = item.id;
    if (!singleUrl.startsWith('http')) {
      singleUrl = `https://www.youtube.com/watch?v=${item.id}`;
    }
    
    const reqBody = {
      url: singleUrl,
      type: downloadType,
      quality: downloadType === 'video' ? videoQuality : audioQuality,
      format_id: 'best'
    };
    
    try {
      const isSpotify = singleUrl.includes('spotify.com');
      const endpoint = isSpotify ? '/spotify/download' : '/download';

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to start download");
      
      const taskIds = data.task_ids;
      setActiveTasks(prev => {
        const newTasks = { ...prev };
        taskIds.forEach((taskId, index) => {
          let partTitle = item.title;
          if (taskIds.length > 1) {
            partTitle = `${item.title} (Part ${index + 1})`;
          }
          newTasks[taskId] = {
            task_id: taskId,
            title: partTitle,
            status: 'pending',
            progress: 0.0,
            speed: '0 KB/s',
            eta: '00:00',
            type: downloadType
          };
          startPolling(taskId);
        });
        return newTasks;
      });
      showToast(`Download started: ${item.title}`);
    } catch (err) {
      showToast(err.message || "Failed to start download", "error");
    }
  };

  const handleDownload = async () => {
    if (!mediaInfo) return;
    
    const isPlaylist = mediaInfo.is_playlist;
    const reqBody = {
      url: url,
      type: downloadType,
      quality: downloadType === 'video' ? videoQuality : audioQuality,
      format_id: 'best'
    };
    
    if (isPlaylist) {
      if (selectedItems.length === 0) {
        showToast("Please select at least one item to download", "error");
        return;
      }
      reqBody.selected_items = selectedItems;
      reqBody.type = 'playlist';
    }
    
    try {
      const isSpotify = url.includes('spotify.com');
      const endpoint = isSpotify ? '/spotify/download' : '/download';

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to start download");
      }
      
      const taskIds = data.task_ids;
      
      // Initialize active task state
      setActiveTasks(prev => {
        const newTasks = { ...prev };
        taskIds.forEach((taskId, index) => {
          let partTitle = mediaInfo.title;
          if (taskIds.length > 1) {
            partTitle = `${mediaInfo.title} (Part ${index + 1})`;
          }
          newTasks[taskId] = {
            task_id: taskId,
            title: partTitle,
            status: 'pending',
            progress: 0.0,
            speed: '0 KB/s',
            eta: '00:00',
            type: downloadType
          };
          startPolling(taskId);
        });
        return newTasks;
      });
      
      showToast("Download started in background");
    } catch (err) {
      showToast(err.message || "Failed to start download", "error");
    }
  };

  const handleCancel = async (taskId) => {
    try {
      const res = await fetch(`${API_BASE}/cancel/${taskId}`, {
        method: 'DELETE'
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to cancel task");
      }
      
      if (pollingIntervals.current[taskId]) {
        clearInterval(pollingIntervals.current[taskId]);
        delete pollingIntervals.current[taskId];
      }
      
      showToast("Cancellation requested");
    } catch (err) {
      showToast(err.message || "Failed to cancel task", "error");
    }
  };

  const handleRetry = async (taskId) => {
    try {
      const res = await fetch(`${API_BASE}/retry/${taskId}`, { method: 'POST' });
      if (!res.ok) throw new Error("Retry failed");
      showToast("Retrying download", "info");
      startPolling(taskId);
    } catch (err) {
      showToast("Failed to retry", "error");
    }
  };

  const clearHistory = () => {
    setHistory([]);
    showToast("History cleared", "info");
  };

  const deleteHistoryItem = (taskId) => {
    setHistory(prev => prev.filter(item => item.task_id !== taskId));
    showToast("Item deleted", "info");
  };

  const togglePlaylistItem = (index) => {
    setSelectedItems(prev => {
      if (prev.includes(index)) {
        return prev.filter(i => i !== index);
      } else {
        return [...prev, index].sort((a, b) => a - b);
      }
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-300 ${isDark ? 'bg-gray-950 text-gray-100' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* Toast Overlay */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center justify-between p-4 rounded-xl shadow-lg border animate-pulse-subtle transition-all duration-300 ${
              t.type === 'error' 
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                : t.type === 'info' 
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            }`}
          >
            <div className="flex items-center gap-3">
              {t.type === 'error' && (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              )}
              {t.type === 'info' && (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              {t.type === 'success' && (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              <span className="text-sm font-medium">{t.message}</span>
            </div>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="text-gray-400 hover:text-white ml-4">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
      </div>

      {/* Navigation Header */}
      <header className={`border-b sticky top-0 z-30 transition-colors duration-300 ${isDark ? 'bg-gray-950/80 border-gray-800' : 'bg-white/80 border-slate-200'} backdrop-blur-md`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-white font-bold shadow-md shadow-rose-500/20">
              AP
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Abs<span className="gradient-text">Play</span></h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2.5 h-2.5 rounded-full ${backendUp ? 'bg-emerald-500 shadow-md shadow-emerald-500/30' : 'bg-rose-500 shadow-md shadow-rose-500/30 animate-pulse'}`}></span>
                <span className="text-xs text-gray-400">{backendUp ? 'Service Online' : 'Service Offline'}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsDark(!isDark)}
              className={`p-2.5 rounded-xl border transition-all duration-200 hover:scale-105 active:scale-95 ${
                isDark 
                  ? 'bg-gray-900 border-gray-800 text-yellow-400 hover:bg-gray-800' 
                  : 'bg-white border-slate-200 text-rose-600 hover:bg-slate-50'
              }`}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 100 10 5 5 0 000-10z" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Body Grid */}
      <main className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Inputs and options (Col span: 7) */}
        <section className="lg:col-span-7 flex flex-col gap-6">
          
          {/* URL Input Form */}
          <div className={`p-6 rounded-2xl transition-all duration-300 ${isDark ? 'glass-card-dark' : 'glass-card-light'}`}>
            <h2 className="text-lg font-bold mb-1">Analyze Media Link</h2>
            <p className="text-sm text-gray-400 mb-4">Support YouTube (Videos & Playlists), Vimeo, SoundCloud, and 1000+ popular platforms.</p>
            
            <form onSubmit={handleAnalyze} className="flex flex-col gap-3">
              <div className="relative">
                <input
                  type="url"
                  placeholder="Paste media link here... (e.g. https://www.youtube.com/watch?...)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className={`w-full py-4 pl-4 pr-24 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-all ${
                    isDark 
                      ? 'bg-gray-900 border-gray-800 text-white focus:ring-rose-500/50 focus:border-rose-500' 
                      : 'bg-white border-slate-200 text-slate-900 focus:ring-rose-600/30 focus:border-rose-600'
                  }`}
                  required
                />
                <div className="absolute right-2 top-2 flex items-center gap-1.5">
                  {url && (
                    <button
                      type="button"
                      onClick={() => setUrl('')}
                      className="p-2 text-gray-400 hover:text-gray-200 transition-colors"
                      title="Clear text"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePaste}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-semibold hover:scale-105 active:scale-95 transition-all ${
                      isDark 
                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700' 
                        : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Paste
                  </button>
                </div>
              </div>
              
              <button
                type="submit"
                disabled={analyzing}
                className={`w-full py-3.5 rounded-xl text-white font-semibold transition-all duration-300 flex items-center justify-center gap-2 glow-effect hover:scale-[1.01] active:scale-[0.99] ${
                  analyzing 
                    ? 'opacity-80 cursor-not-allowed bg-rose-700' 
                    : 'gradient-bg shadow-md shadow-rose-600/20 hover:shadow-rose-600/35'
                }`}
              >
                {analyzing ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Analyzing Link...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    Analyze Media URL
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Skeletons/Errors */}
          {analyzing && (
            <div className={`p-6 rounded-2xl animate-pulse flex flex-col gap-4 ${isDark ? 'bg-gray-900/50' : 'bg-slate-100'}`}>
              <div className="flex gap-4">
                <div className="w-32 h-20 rounded-lg bg-gray-700"></div>
                <div className="flex-1 flex flex-col gap-2 justify-center">
                  <div className="h-4 bg-gray-700 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-700 rounded w-1/2"></div>
                </div>
              </div>
              <div className="h-10 bg-gray-700 rounded w-full"></div>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <div>
                <h4 className="font-bold">Analysis Failed</h4>
                <p className="mt-0.5 text-xs opacity-90">{error}</p>
              </div>
            </div>
          )}

          {/* Media Info / Download Card */}
          {mediaInfo && (
            <div className={`p-6 rounded-2xl flex flex-col gap-6 animate-pulse-subtle transition-all duration-300 ${isDark ? 'glass-card-dark' : 'glass-card-light'}`}>
              
              {/* Media Header */}
              <div className="flex flex-col sm:flex-row gap-5 items-start">
                {mediaInfo.thumbnail && (
                  <div className="relative rounded-xl overflow-hidden shadow-md w-full sm:w-44 flex-shrink-0 aspect-video">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaInfo.thumbnail} alt={mediaInfo.title} className="w-full h-full object-cover" />
                    {mediaInfo.duration && (
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold text-white tracking-wide">
                        {formatDuration(mediaInfo.duration)}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex-1">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    mediaInfo.is_playlist 
                      ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' 
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  }`}>
                    {mediaInfo.urlType === 'youtube_music_track' ? '🎵 YouTube Music Track'
                      : mediaInfo.urlType === 'youtube_music_playlist' ? '🎵 YouTube Music Playlist'
                      : mediaInfo.urlType === 'youtube_playlist' ? '📂 YouTube Playlist'
                      : mediaInfo.urlType === 'spotify_track' ? '🟢 Spotify Track'
                      : mediaInfo.urlType === 'spotify_playlist' ? '🟢 Spotify Playlist'
                      : '🎬 YouTube Video'}
                  </span>
                  <h3 className="text-lg font-bold leading-snug mt-2 line-clamp-2">{mediaInfo.title}</h3>
                  <p className="text-sm text-gray-400 mt-1 flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    {mediaInfo.creator || mediaInfo.artist}
                  </p>
                </div>
              </div>

              {/* Spotify Match Info */}
              {mediaInfo.urlType === 'spotify_track' && mediaInfo.youtubeMatch && (
                <div className={`mt-4 p-4 rounded-xl border flex gap-4 items-center ${isDark ? 'bg-rose-900/20 border-rose-500/30' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="w-16 h-12 rounded bg-gray-200 overflow-hidden relative shrink-0">
                    {mediaInfo.youtubeMatch.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaInfo.youtubeMatch.thumbnail} alt="Match" className="object-cover w-full h-full" />
                    ) : (
                      <div className="w-full h-full bg-rose-200/50 flex items-center justify-center">🎬</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-rose-500 font-bold tracking-wider uppercase mb-1">Matched YouTube Video</div>
                    <h4 className="text-sm font-semibold truncate text-slate-800 dark:text-slate-200" title={mediaInfo.youtubeMatch.title}>{mediaInfo.youtubeMatch.title}</h4>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{mediaInfo.youtubeMatch.channel}</p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end">
                    <span className="text-xs font-mono text-gray-500 mb-1">{formatDuration(mediaInfo.youtubeMatch.duration)}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-600 dark:text-green-400">
                      {mediaInfo.youtubeMatch.confidence_score}% Match
                    </span>
                  </div>
                </div>
              )}

              {/* Playlist Item Checklist (If Playlist) */}
              {mediaInfo.is_playlist && (mediaInfo.playlist_entries || mediaInfo.tracks) && (
                <div className="border-t border-gray-800/50 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold">Select Playlist Items</h4>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setSelectedItems((mediaInfo.playlist_entries || mediaInfo.tracks).map(x => x.index))}
                        className="text-xs text-rose-400 hover:text-rose-300 font-semibold"
                      >
                        Select All
                      </button>
                      <span className="text-gray-600">|</span>
                      <button
                        onClick={() => setSelectedItems([])}
                        className="text-xs text-gray-400 hover:text-gray-200 font-semibold"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>
                  
                  <div className={`max-h-56 overflow-y-auto border rounded-xl p-2.5 flex flex-col gap-1.5 ${isDark ? 'bg-gray-900/60 border-gray-800' : 'bg-slate-100/50 border-slate-200'}`}>
                    {(mediaInfo.playlist_entries || mediaInfo.tracks).map(item => {
                      const isSelected = selectedItems.includes(item.index);
                      return (
                        <div
                          key={item.id}
                          onClick={() => togglePlaylistItem(item.index)}
                          className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                            isSelected 
                              ? isDark ? 'bg-rose-600/10 text-white' : 'bg-rose-600/5 text-slate-900 font-medium'
                              : 'hover:bg-gray-800/10'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}} // Swallowed, parent onClick handles it
                            className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4 border-gray-700 bg-gray-900"
                          />
                          <span className="text-xs text-gray-500 w-4 text-right">{item.index + 1}</span>
                          <span className="text-xs flex-1 truncate">{item.title}</span>
                          {item.duration && (
                            <span className="text-[10px] text-gray-400 font-mono">{formatDuration(item.duration)}</span>
                          )}
                          <button
                            onClick={(e) => handleSingleItemDownload(item, e)}
                            className={`ml-2 p-1.5 rounded-lg border hover:scale-105 active:scale-95 transition-all ${
                              isDark 
                                ? 'bg-gray-800 border-gray-700 text-rose-400 hover:bg-rose-500/20' 
                                : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'
                            }`}
                            title={`Download ${item.title} as single file`}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-2 text-right">
                    Selected: {selectedItems.length} of {mediaInfo.playlist_entries.length} items
                  </div>
                </div>
              )}

              {/* Download Option Selectors */}
              <div className="border-t border-gray-800/50 pt-5 flex flex-col gap-4">
                
                {/* Mode Selector */}
                {mediaInfo.supportsVideo !== false && (
                <div className="flex gap-4">
                  <button
                    onClick={() => setDownloadType('video')}
                    className={`flex-1 py-3 px-4 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] ${
                      downloadType === 'video'
                        ? 'gradient-bg text-white border-transparent shadow-md shadow-rose-600/10'
                        : isDark
                          ? 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    Download Video
                  </button>
                  <button
                    onClick={() => setDownloadType('audio')}
                    className={`flex-1 py-3 px-4 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] ${
                      downloadType === 'audio'
                        ? 'gradient-bg text-white border-transparent shadow-md shadow-rose-600/10'
                        : isDark
                          ? 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                    Extract MP3 Audio
                  </button>
                </div>
                )}

                {/* Quality Options */}
                <div>
                  <h4 className="text-sm font-bold mb-2.5">Select Quality Output</h4>
                  
                  {downloadType === 'video' && mediaInfo.supportsVideo !== false ? (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {[
                        { label: 'Best Available', value: 'best' },
                        { label: '1080p (FHD)', value: '1080p' },
                        { label: '720p (HD)', value: '720p' },
                        { label: '480p (SD)', value: '480p' },
                        { label: '360p (SD)', value: '360p' }
                      ].map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setVideoQuality(opt.value)}
                          className={`py-2 px-3 rounded-lg border text-xs font-medium text-center transition-all ${
                            videoQuality === opt.value
                              ? 'border-rose-500 bg-rose-500/10 text-rose-400 font-bold'
                              : isDark
                                ? 'bg-gray-900/50 border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { label: 'Best Bitrate', value: 'best' },
                        { label: 'High Quality (192 kbps)', value: '192kbps' },
                        { label: 'Standard Quality (128 kbps)', value: '128kbps' }
                      ].map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setAudioQuality(opt.value)}
                          className={`py-2 px-3 rounded-lg border text-xs font-medium text-center transition-all ${
                            audioQuality === opt.value
                              ? 'border-rose-500 bg-rose-500/10 text-rose-400 font-bold'
                              : isDark
                                ? 'bg-gray-900/50 border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirm Action Button */}
                <button
                  onClick={handleDownload}
                  disabled={!backendUp || (mediaInfo.is_playlist && selectedItems.length === 0)}
                  className="w-full py-4 mt-2 rounded-xl text-white font-bold transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-emerald-700/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  {mediaInfo.is_playlist 
                    ? `Package ${selectedItems.length} items as ZIP`
                    : `Process Single Download`
                  }
                </button>
              </div>

            </div>
          )}

          {/* Landing / Help Page (If no media analyzed) */}
          {!mediaInfo && !analyzing && (
            <div className="flex flex-col gap-6">
              
              {/* How it Works / Feature grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className={`p-5 rounded-2xl border ${isDark ? 'bg-gray-900/40 border-gray-800/80' : 'bg-white border-slate-200/80'}`}>
                  <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center font-bold mb-3">1</div>
                  <h4 className="text-sm font-bold mb-1">Analyze</h4>
                  <p className="text-xs text-gray-400 leading-relaxed">Paste any public URL. The tool parses titles, thumbnails, formats, or playlist chapters instantly.</p>
                </div>
                <div className={`p-5 rounded-2xl border ${isDark ? 'bg-gray-900/40 border-gray-800/80' : 'bg-white border-slate-200/80'}`}>
                  <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center font-bold mb-3">2</div>
                  <h4 className="text-sm font-bold mb-1">Configure</h4>
                  <p className="text-xs text-gray-400 leading-relaxed">Select between video (MP4) and audio (MP3) formats. Pick resolutions from 360p up to full HD 1080p.</p>
                </div>
                <div className={`p-5 rounded-2xl border ${isDark ? 'bg-gray-900/40 border-gray-800/80' : 'bg-white border-slate-200/80'}`}>
                  <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center font-bold mb-3">3</div>
                  <h4 className="text-sm font-bold mb-1">Process</h4>
                  <p className="text-xs text-gray-400 leading-relaxed">Track backgrounds progress percentages in real-time, click cancel anytime, and receive a ZIP automatically.</p>
                </div>
              </div>

              {/* FAQ */}
              <div className={`p-6 rounded-2xl ${isDark ? 'bg-gray-900/30' : 'bg-white border border-slate-200'}`}>
                <h3 className="text-base font-bold mb-4">Frequently Asked Questions</h3>
                <div className="flex flex-col gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-1">Q: Does playlist download support selection?</h4>
                    <p className="text-xs text-gray-400 leading-relaxed">Yes! You can choose which videos to download in the checklist, download them as audio or video, and they will be archived into a single ZIP file.</p>
                  </div>
                  <hr className={isDark ? 'border-gray-850' : 'border-slate-100'} />
                  <div>
                    <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-1">Q: What formats are supported?</h4>
                    <p className="text-xs text-gray-400 leading-relaxed">Videos are processed as MP4 container files, and audio streams are converted to high-quality MP3 (128kbps, 192kbps, or best variable) via FFmpeg postprocessors.</p>
                  </div>
                </div>
              </div>

            </div>
          )}

        </section>

        {/* Right Side: Active tasks and History (Col span: 5) */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Active Tasks Panel */}
          <div className={`p-6 rounded-2xl transition-all duration-300 ${isDark ? 'glass-card-dark' : 'glass-card-light'}`}>
            <div className="flex items-center justify-between mb-4 border-b border-gray-800/40 pb-3">
              <h2 className="text-base font-bold flex items-center gap-2">
                Active Downloads
                {Object.keys(activeTasks).length > 0 && (
                  <span className="w-5 h-5 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center animate-bounce">
                    {Object.keys(activeTasks).length}
                  </span>
                )}
              </h2>
            </div>

            {Object.keys(activeTasks).length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>
                No active background tasks
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {Object.values(activeTasks).map(task => (
                  <div key={task.task_id} className={`p-4 rounded-xl border flex flex-col gap-2.5 ${
                    ['failed', 'cancelled'].includes(task.status)
                      ? 'bg-rose-500/10 border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.1)]' 
                      : task.status === 'completed'
                        ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                        : isDark ? 'bg-gray-900/60 border-gray-800' : 'bg-slate-100 border-slate-200'
                  }`}>
                    
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className={`text-xs font-bold truncate pr-2 ${task.status === 'completed' ? 'text-emerald-500' : ['failed', 'cancelled'].includes(task.status) ? 'text-rose-500' : ''}`}>
                          {task.title || 'Processing file...'}
                        </h4>
                        <span className="text-[9px] text-gray-400 font-mono mt-0.5 block truncate">ID: {task.task_id}</span>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex gap-2">
                        {['pending', 'downloading', 'converting'].includes(task.status) && (
                          <button
                            onClick={() => handleCancel(task.task_id)}
                            className={`p-1.5 rounded-lg border hover:scale-105 active:scale-95 transition-all ${
                              isDark 
                                ? 'bg-gray-800 border-gray-700 text-gray-400 hover:text-rose-400 hover:bg-rose-500/10' 
                                : 'bg-white border-slate-200 text-slate-500 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                            title="Cancel Download"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                        {task.status === 'completed' && (
                          <button
                            onClick={() => triggerFileDownload(task.task_id, task.filename)}
                            className="p-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 hover:scale-105 active:scale-95 transition-all"
                            title="Download File"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                        )}
                        {['failed', 'cancelled'].includes(task.status) && (
                          <button
                            onClick={() => handleRetry(task.task_id)}
                            className="p-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 hover:scale-105 active:scale-95 transition-all"
                            title="Retry Download"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setActiveTasks(prev => {
                              const copy = { ...prev };
                              delete copy[task.task_id];
                              return copy;
                            });
                          }}
                          className={`p-1.5 rounded-lg border hover:scale-105 active:scale-95 transition-all ${
                            isDark 
                              ? 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700' 
                              : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                          }`}
                          title="Dismiss Task"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="flex flex-col gap-1">
                      <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 rounded-full ${
                            ['failed', 'cancelled'].includes(task.status)
                              ? 'bg-rose-500' 
                              : task.status === 'completed'
                                ? 'bg-emerald-500'
                                : task.status === 'converting' 
                                  ? 'bg-orange-500 animate-pulse'
                                  : 'gradient-bg'
                          }`}
                          style={{ width: `${task.progress || 0}%` }}
                        ></div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-gray-400 mt-0.5">
                        <span className={`capitalize font-semibold ${task.status === 'completed' ? 'text-emerald-500' : ['failed', 'cancelled'].includes(task.status) ? 'text-rose-500' : ''}`}>
                          {task.status}
                        </span>
                        <span>{Math.round(task.progress || 0)}%</span>
                      </div>
                    </div>

                    {/* Meta speeds */}
                    {task.status === 'downloading' && (
                      <div className="flex items-center justify-between text-[10px] font-mono text-gray-400 border-t border-gray-800/30 pt-2">
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          {task.speed || '0 KB/s'}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          ETA: {task.eta || '00:00'}
                        </span>
                      </div>
                    )}

                    {task.error && (
                      <div className="text-[10px] text-rose-400 font-semibold leading-relaxed border-t border-rose-950/20 pt-2 break-words">
                        Error: {task.error}
                      </div>
                    )}

                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Download History Panel */}
          <div className={`p-6 rounded-2xl transition-all duration-300 ${isDark ? 'glass-card-dark' : 'glass-card-light'}`}>
            <div className="flex items-center justify-between mb-4 border-b border-gray-800/40 pb-3">
              <h2 className="text-base font-bold">Download History</h2>
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="text-xs text-rose-400 hover:text-rose-300 font-semibold transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                No download history saved
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
                {history.map(item => (
                  <div key={item.task_id} className={`p-3 rounded-xl border flex gap-3 items-center justify-between group transition-all duration-200 ${
                    isDark ? 'bg-gray-900/30 border-gray-800 hover:bg-gray-900/50' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-semibold truncate" title={item.filename}>{item.title}</h4>
                      <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1.5">
                        <span className={`capitalize font-bold px-1.5 py-0.5 rounded text-[8px] ${
                          item.type === 'audio' 
                            ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20' 
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {item.type}
                        </span>
                        <span>{item.date}</span>
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                      {/* Redownload file */}
                      <button
                        onClick={() => triggerFileDownload(item.task_id, item.filename)}
                        className={`p-1.5 rounded-lg border hover:scale-105 active:scale-95 transition-all ${
                          isDark 
                            ? 'bg-gray-800 border-gray-700 text-emerald-400 hover:bg-emerald-500/10' 
                            : 'bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50'
                        }`}
                        title="Download file again"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      </button>
                      
                      {/* Delete log */}
                      <button
                        onClick={() => deleteHistoryItem(item.task_id)}
                        className={`p-1.5 rounded-lg border hover:scale-105 active:scale-95 transition-all ${
                          isDark 
                            ? 'bg-gray-800 border-gray-700 text-gray-400 hover:text-rose-400 hover:bg-rose-500/10' 
                            : 'bg-white border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                        }`}
                        title="Remove from history"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>

        </section>

      </main>

      {/* Footer */}
      <footer className={`border-t py-8 text-center text-xs transition-colors duration-300 mt-12 ${
        isDark ? 'bg-gray-950/40 border-gray-900 text-gray-500' : 'bg-slate-100 border-slate-200 text-slate-500'
      }`}>
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} AbsPlay. Developed for educational purposes.</p>
          <div className="flex gap-4">
            <span className="hover:text-rose-400 transition-colors">Clean Architecture</span>
            <span>•</span>
            <span className="hover:text-rose-400 transition-colors">FastAPI Backend</span>
            <span>•</span>
            <span className="hover:text-rose-400 transition-colors">Next.js UI</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

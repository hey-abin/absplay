'use client';

import React, { useState, useEffect, useRef } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeTask, setAnalyzeTask] = useState(null); // Track analysis progress
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
  const [showTasksPopup, setShowTasksPopup] = useState(false);
  const [showHistoryPopup, setShowHistoryPopup] = useState(false);
  
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
      
      if (isSpotify) {
        // Handle async analysis
        const taskId = data.task_id;
        
        const pollAnalysis = setInterval(async () => {
          try {
            const pRes = await fetch(`${API_BASE}/spotify/progress/${taskId}`);
            if (!pRes.ok) throw new Error("Progress fetch failed");
            const pData = await pRes.json();
            
            setAnalyzeTask(pData);
            
            if (pData.status === 'completed') {
              clearInterval(pollAnalysis);
              setAnalyzeTask(null);
              setAnalyzing(false);
              
              const result = pData.result;
              setMediaInfo(result);
              const entries = result.playlist_entries || result.tracks;
              if (result.isPlaylist && entries) {
                setSelectedItems(entries.map(item => item.index));
              }
              if (result.supportsVideo === false) {
                setDownloadType('audio');
              } else {
                setDownloadType('video');
              }
              showToast("Analysis Completed");
            } else if (pData.status === 'failed') {
              clearInterval(pollAnalysis);
              setAnalyzeTask(null);
              setAnalyzing(false);
              setError(pData.error || "Analysis failed");
              showToast("Analysis failed", "error");
            }
          } catch (err) {
            console.error(err);
            clearInterval(pollAnalysis);
            setAnalyzeTask(null);
            setAnalyzing(false);
            setError("Polling failed");
          }
        }, 1000);
        return; // exit early, polling will set final state
      } else {
        setMediaInfo(data);
        const entries = data.playlist_entries || data.tracks;
        if (data.is_playlist && entries) {
          setSelectedItems(entries.map(item => item.index));
        }
        if (data.supportsVideo === false) {
          setDownloadType('audio');
        } else {
          setDownloadType('video');
        }
        showToast("Analysis Completed");
      }
    } catch (err) {
      setError(err.message || "An unexpected error occurred");
      showToast(err.message || "Analysis failed", "error");
    } finally {
      if (!url.includes('spotify.com')) {
        setAnalyzing(false);
      }
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
          
          setTimeout(() => {
            setActiveTasks(prev => {
              if (!prev[taskId]) return prev;
              const next = { ...prev };
              delete next[taskId];
              return next;
            });
          }, 45000);
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
    
    const isPlaylist = mediaInfo.is_playlist || mediaInfo.isPlaylist;
    const reqBody = {
      url: url,
      type: downloadType,
      quality: downloadType === 'video' ? videoQuality : audioQuality,
      format_id: 'best'
    };
    
    const isSpotify = url.includes('spotify.com');

    if (isPlaylist) {
      if (selectedItems.length === 0) {
        showToast("Please select at least one item to download", "error");
        return;
      }
      if (isSpotify) {
         // Spotify individual track mapping
         const entries = mediaInfo.tracks || mediaInfo.playlist_entries || [];
         const selectedTracks = entries.filter(t => selectedItems.includes(t.index));
         reqBody.tracks = selectedTracks.map(t => ({
           title: t.title,
           youtube_url: t.youtubeMatch?.youtube_url || null,
           spotify_metadata: t
         }));
         reqBody.is_playlist = selectedItems.length > 1;
         reqBody.title = mediaInfo.title || "Spotify Playlist";
      } else {
         reqBody.selected_items = selectedItems;
         reqBody.type = 'playlist';
      }
    } else {
      if (isSpotify) {
         reqBody.tracks = [{
           title: mediaInfo.title,
           youtube_url: mediaInfo.youtubeMatch?.youtube_url
         }].filter(t => t.youtube_url);
      }
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
      
      showToast("Cancellation requested");
    } catch (err) {
      showToast(err.message || "Failed to cancel task", "error");
    }
  };

  const handleCancelAll = async () => {
    const activeTaskIds = Object.keys(activeTasks).filter(taskId => {
      const status = activeTasks[taskId].status;
      return status === 'pending' || status === 'processing' || status === 'downloading';
    });
    
    if (activeTaskIds.length === 0) return;
    
    for (const taskId of activeTaskIds) {
      handleCancel(taskId).catch(e => console.error(e));
    }
    showToast(`Cancellation requested for ${activeTaskIds.length} tasks`);
  };

  const handleRemoveTask = (taskId) => {
    const task = activeTasks[taskId];
    if (task && ['pending', 'processing', 'downloading', 'converting'].includes(task.status)) {
       handleCancel(taskId).catch(() => {});
    }
    setActiveTasks(prev => {
      const newTasks = { ...prev };
      delete newTasks[taskId];
      return newTasks;
    });
    if (pollingIntervals.current[taskId]) {
      clearInterval(pollingIntervals.current[taskId]);
      delete pollingIntervals.current[taskId];
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
  }  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-300 bg-[#0B1120] text-gray-100`}>
      
      {/* Toast Overlay */}
      <div className="fixed top-24 right-4 z-[70] flex flex-col gap-3 w-[calc(100%-2rem)] sm:top-24 sm:right-6 sm:max-w-sm sm:w-full pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between p-4 rounded-xl shadow-2xl border backdrop-blur-md transition-all duration-300 ${
              t.type === 'error' 
                ? 'bg-rose-950/90 border-rose-500/30 text-rose-400' 
                : t.type === 'info' 
                  ? 'bg-indigo-950/90 border-indigo-500/30 text-indigo-400' 
                  : 'bg-emerald-950/90 border-emerald-500/30 text-emerald-400'
            }`}
          >
            <div className="flex items-center gap-3">
              {t.type === 'error' && (
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              )}
              {t.type === 'info' && (
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              {t.type === 'success' && (
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              <span className="text-sm font-medium">{t.message}</span>
            </div>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="text-gray-400 hover:text-white ml-4 flex-shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
      </div>

      {/* Navigation Header */}
      <header className="border-b border-transparent sticky top-0 z-30 transition-colors duration-300 bg-[#0B1120]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-white font-bold shadow-md">
              AP
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">AbsPlay</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2.5 h-2.5 rounded-full ${backendUp ? 'bg-emerald-500 shadow-md shadow-emerald-500/30' : 'bg-rose-500 shadow-md shadow-rose-500/30 animate-pulse'}`}></span>
                <span className="text-xs text-gray-400">{backendUp ? 'Service Online' : 'Service Offline'}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Active Tasks Icon */}
            <button
              onClick={() => setShowTasksPopup(true)}
              className="p-2 rounded-xl transition-all duration-200 bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800 relative"
              title="Active Downloads"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              {Object.keys(activeTasks).length > 0 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-[#0B1120]"></span>
              )}
            </button>
            
            {/* History Icon */}
            <button
              onClick={() => setShowHistoryPopup(true)}
              className="p-2 rounded-xl transition-all duration-200 bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800 relative"
              title="Download History"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {history.length > 0 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-purple-500 rounded-full border-2 border-[#0B1120]"></span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Body Grid */}
      <main className="flex-1 max-w-5xl mx-auto px-6 py-12 w-full flex flex-col items-center">
        
        {/* Hero Section */}
        <div className="text-center mb-10 w-full">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">Download. Convert. Enjoy.</h2>
          <p className="text-gray-400 text-base md:text-lg max-w-2xl mx-auto">
            Analyze media links and download your favorite videos and audio from 1000+ platforms.
          </p>
        </div>

        {/* Input Area */}
        <div className="w-full max-w-3xl mx-auto mb-6">
          <form onSubmit={handleAnalyze} className="w-full flex flex-col sm:flex-row gap-3">
            <div className="flex-1 gradient-border-wrapper p-1 rounded-xl">
              <div className="flex items-center bg-[#0B1120] rounded-[10px] px-4 py-2 w-full h-full">
                <svg className="w-5 h-5 text-gray-500 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                <input
                  type="url"
                  placeholder="Paste media link here..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-transparent text-sm text-gray-200 focus:outline-none py-3"
                  required
                />
                <button
                  type="button"
                  onClick={handlePaste}
                  className="ml-3 py-1.5 px-4 rounded-lg bg-gray-800 text-xs font-semibold text-gray-300 hover:bg-gray-700 transition-colors shrink-0"
                >
                  Paste
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={analyzing}
              className="w-full sm:w-auto px-6 py-4 rounded-xl text-white font-semibold flex items-center justify-center gap-2 gradient-bg shadow-md shrink-0 transition-transform active:scale-95"
            >
              {analyzing ? (
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <>
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Analyze
                </>
              )}
            </button>
          </form>
        </div>

        {/* Supports Line */}
        <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mb-8">
          <span>Supports:</span>
          <div className="flex items-center gap-1"><span className="text-red-500 text-lg">▶</span> YouTube</div>
          <div className="flex items-center gap-1"><span className="text-orange-500 text-lg">☁</span> SoundCloud</div>
          <div className="flex items-center gap-1"><span className="text-blue-400 text-lg">v</span> Vimeo</div>
          <span>+ 1000 more</span>
        </div>

        {/* --- Media Info Section --- */}
        <div className="w-full max-w-3xl mx-auto">
          {/* Skeletons/Errors */}
          {analyzing && (
            <div className="p-6 rounded-2xl flex flex-col gap-4 bg-[#131C31] mb-8 shadow-lg border border-gray-800">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 gradient-bg">
                   <svg className="animate-spin w-6 h-6 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white mb-1">
                    {analyzeTask ? (analyzeTask.title || 'Analyzing...') : 'Extracting Metadata...'}
                  </h3>
                  <div className="w-full bg-gray-800 rounded-full h-2 mb-1 overflow-hidden">
                    <div 
                      className="bg-purple-500 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${analyzeTask ? analyzeTask.progress : 100}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-start gap-3 mb-8">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <div>
                <h4 className="font-bold">Analysis Failed</h4>
                <p className="mt-0.5 text-xs opacity-90">{error}</p>
              </div>
            </div>
          )}

          {/* Media Info / Download Card */}
          {mediaInfo && (
            <div className="p-6 rounded-2xl flex flex-col gap-6 animate-pulse-subtle bg-[#131C31] border border-gray-800 mb-12 w-full shadow-lg">
              
              {/* Media Header */}
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                {mediaInfo.thumbnail && (
                  <div className={`relative rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 w-full flex-shrink-0 bg-gray-900 ${
                    mediaInfo.urlType.includes('spotify') ? 'aspect-square sm:w-48 sm:h-48' : 'aspect-video sm:w-72'
                  }`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaInfo.thumbnail} alt={mediaInfo.title} className="w-full h-full object-cover" />
                    {mediaInfo.duration && (
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-bold text-white tracking-wide backdrop-blur-sm">
                        {formatDuration(mediaInfo.duration)}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex-1 mt-1 sm:mt-0">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold border shadow-sm ${
                    mediaInfo.urlType.includes('spotify')
                      ? 'bg-[#1DB954]/10 text-[#1DB954] border-[#1DB954]/30'
                      : mediaInfo.urlType.includes('youtube')
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                  }`}>
                    {mediaInfo.urlType.includes('spotify') && <span className="mr-1.5 w-1.5 h-1.5 rounded-full bg-[#1DB954]"></span>}
                    {mediaInfo.urlType === 'youtube_music_track' ? '🎵 YouTube Music Track'
                      : mediaInfo.urlType === 'youtube_music_playlist' ? '🎵 YouTube Music Playlist'
                      : mediaInfo.urlType === 'youtube_playlist' ? '📂 YouTube Playlist'
                      : mediaInfo.urlType === 'spotify_track' ? 'Spotify Track'
                      : mediaInfo.urlType === 'spotify_playlist' ? 'Spotify Playlist'
                      : '🎬 YouTube Video'}
                  </span>
                  <h3 className="text-xl md:text-2xl font-bold leading-snug mt-3 line-clamp-2 text-white">{mediaInfo.title}</h3>
                  <p className="text-sm md:text-base text-gray-400 mt-2 flex items-center gap-2">
                    <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    {mediaInfo.creator || mediaInfo.artist}
                  </p>
                </div>
              </div>

              {/* Spotify Match Info */}
              {mediaInfo.urlType === 'spotify_track' && mediaInfo.youtubeMatch && (
                <div className="mt-4 p-4 md:p-5 rounded-2xl border flex flex-col sm:flex-row gap-4 items-center bg-gray-900/60 border-gray-800">
                  <div className="w-full sm:w-32 aspect-video rounded-xl bg-gray-800 overflow-hidden relative shrink-0 shadow-md">
                    {mediaInfo.youtubeMatch.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaInfo.youtubeMatch.thumbnail} alt="Match" className="object-cover w-full h-full" />
                    ) : (
                      <div className="w-full h-full bg-rose-900/50 flex items-center justify-center text-xl">🎬</div>
                    )}
                    <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-bold text-white tracking-wide">
                      {formatDuration(mediaInfo.youtubeMatch.duration)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] text-gray-400 font-bold tracking-widest uppercase">Matched YouTube Video</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">
                        {mediaInfo.youtubeMatch.confidence_score}% Match
                      </span>
                    </div>
                    <h4 className="text-sm md:text-base font-bold truncate text-slate-200" title={mediaInfo.youtubeMatch.title}>{mediaInfo.youtubeMatch.title}</h4>
                    <p className="text-xs md:text-sm text-gray-500 truncate mt-0.5">{mediaInfo.youtubeMatch.channel}</p>
                  </div>
                </div>
              )}

              {/* Playlist Item Checklist (If Playlist) */}
              {(mediaInfo.is_playlist || mediaInfo.isPlaylist) && (mediaInfo.playlist_entries || mediaInfo.tracks) && (
                <div className="border-t border-gray-800/50 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-white">Select Playlist Items</h4>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setSelectedItems((mediaInfo.playlist_entries || mediaInfo.tracks).map(x => x.index))}
                        className="text-xs text-purple-400 hover:text-purple-300 font-semibold"
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
                  
                  <div className="max-h-56 overflow-y-auto border rounded-xl p-2.5 flex flex-col gap-1.5 bg-gray-900/60 border-gray-800">
                    {(mediaInfo.playlist_entries || mediaInfo.tracks).map(item => {
                      const isSelected = selectedItems.includes(item.index);
                      return (
                        <div
                          key={item.id}
                          onClick={() => togglePlaylistItem(item.index)}
                          className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                            isSelected 
                              ? 'bg-purple-600/20 text-white border border-purple-500/30'
                              : 'hover:bg-gray-800/40 text-gray-300 border border-transparent'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}} // Swallowed, parent onClick handles it
                            className="rounded text-purple-600 focus:ring-purple-500 w-4 h-4 border-gray-700 bg-gray-900"
                          />
                          <span className="text-xs text-gray-500 w-4 text-right">{item.index + 1}</span>
                          <span className="text-xs flex-1 truncate">{item.title}</span>
                          {item.duration && (
                            <span className="text-[10px] text-gray-500 font-mono">{formatDuration(item.duration)}</span>
                          )}
                          <button
                            onClick={(e) => handleSingleItemDownload(item, e)}
                            className="ml-2 p-1.5 rounded-lg bg-gray-800 border-gray-700 text-purple-400 hover:bg-purple-500/20 transition-all hover:scale-105 active:scale-95"
                            title={`Download ${item.title} as single file`}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-2 text-right">
                    Selected: {selectedItems.length} of {(mediaInfo.playlist_entries || mediaInfo.tracks).length} items
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
                    className={`flex-1 py-4 px-4 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 ${
                      downloadType === 'video'
                        ? 'bg-gradient-to-r from-violet-600 to-indigo-600 border-transparent shadow-[0_0_20px_rgba(124,58,237,0.4)] text-white'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    Download Video
                  </button>
                  <button
                    onClick={() => setDownloadType('audio')}
                    className={`flex-1 py-4 px-4 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 ${
                      downloadType === 'audio'
                        ? 'bg-gradient-to-r from-fuchsia-600 to-pink-600 border-transparent shadow-[0_0_20px_rgba(217,70,239,0.4)] text-white'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                    Extract MP3 Audio
                  </button>
                </div>
                )}

                {/* Quality Options */}
                <div>
                  <h4 className="text-sm font-bold mb-2.5 text-white">Select Quality Output</h4>
                  
                  {downloadType === 'video' && mediaInfo.supportsVideo !== false ? (
                    <div className="flex flex-wrap gap-2.5">
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
                          className={`py-2 px-5 rounded-full border text-sm font-semibold transition-all duration-300 ${
                            videoQuality === opt.value
                              ? 'border-violet-500/50 bg-violet-500/20 text-violet-300 shadow-[0_0_15px_rgba(139,92,246,0.2)]'
                              : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 hover:border-slate-700'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {[
                        { label: 'Best Bitrate', value: 'best' },
                        { label: 'High Quality (192 kbps)', value: '192kbps' },
                        { label: 'Standard Quality (128 kbps)', value: '128kbps' }
                      ].map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setAudioQuality(opt.value)}
                          className={`py-2 px-5 rounded-full border text-sm font-semibold transition-all duration-300 ${
                            audioQuality === opt.value
                              ? 'border-fuchsia-500/50 bg-fuchsia-500/20 text-fuchsia-300 shadow-[0_0_15px_rgba(217,70,239,0.2)]'
                              : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 hover:border-slate-700'
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
                  className="w-full py-4 mt-2 rounded-xl text-white font-bold transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 hover:scale-[1.01] active:scale-[0.99] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  {mediaInfo.is_playlist ? `Download ${selectedItems.length} Items` : 'Download Media'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mb-16 max-w-5xl">
          <div className="p-5 rounded-2xl bg-[#0F172A]/50 border border-gray-800/60 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-600/20 text-purple-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white mb-1">Smart Analyze</h3>
              <p className="text-xs text-gray-400 leading-relaxed">Extracts title, thumbnail, formats and more instantly.</p>
            </div>
          </div>
          <div className="p-5 rounded-2xl bg-[#0F172A]/50 border border-gray-800/60 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-pink-600/20 text-pink-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white mb-1">Choose & Configure</h3>
              <p className="text-xs text-gray-400 leading-relaxed">Select quality, format and customize your download.</p>
            </div>
          </div>
          <div className="p-5 rounded-2xl bg-[#0F172A]/50 border border-gray-800/60 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 text-blue-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white mb-1">Download Fast</h3>
              <p className="text-xs text-gray-400 leading-relaxed">High speed downloads with real-time progress tracking.</p>
            </div>
          </div>
        </div>

      </main>

      {/* --- Popups --- */}
      {/* Active Tasks Popup */}
      {showTasksPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-start justify-center p-4 pt-16 sm:pt-24 pb-10 overflow-y-auto">
          <div className="bg-[#0B1120] border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[75vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-800/60">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Active Downloads
              </h2>
              <div className="flex items-center gap-3">
                {Object.values(activeTasks).some(t => ['pending', 'processing', 'downloading'].includes(t.status)) && (
                  <button onClick={handleCancelAll} className="text-xs text-rose-400 hover:text-rose-300 font-semibold transition-colors">
                    Cancel All
                  </button>
                )}
                <button onClick={() => setShowTasksPopup(false)} className="text-gray-400 hover:text-white p-1">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              {Object.keys(activeTasks).length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">No active downloads running.</div>
              ) : (
                <div className="flex flex-col gap-4">
                  {Object.values(activeTasks).reverse().map(task => (
                    <div key={task.task_id} className="p-4 rounded-xl bg-[#131C31] border border-gray-800 flex flex-col gap-3">
                      <div className="flex justify-between items-start gap-4">
                        <h4 className="text-sm font-semibold text-white truncate flex-1" title={task.title}>{task.title}</h4>
                        <div className="flex gap-2 shrink-0 items-center">
                          {['pending', 'processing', 'downloading', 'converting'].includes(task.status) ? (
                            <button onClick={() => handleCancel(task.task_id)} className="text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 px-2 py-1 rounded">Cancel</button>
                          ) : task.status === 'failed' || task.status === 'cancelled' ? (
                            <button onClick={() => handleRetry(task.task_id)} className="text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded">Retry</button>
                          ) : task.status === 'completed' && (
                            <button onClick={() => triggerFileDownload(task.task_id, task.filename)} className="text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-2 py-1 rounded">Download</button>
                          )}
                          <button onClick={() => handleRemoveTask(task.task_id)} className="text-gray-500 hover:text-gray-300 transition-colors p-1" title="Close Task">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-300 ${task.status === 'completed' ? 'bg-emerald-500' : task.status === 'failed' ? 'bg-rose-500' : 'bg-purple-500'}`}
                            style={{ width: `${task.progress || 0}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-400 font-mono">
                          <span>{task.status.toUpperCase()}</span>
                          {task.status === 'processing' && <span>{task.speed} • {task.eta}</span>}
                          {task.status === 'completed' && <span className="text-emerald-400">Done</span>}
                          {task.status === 'failed' && <span className="text-rose-400">{task.error || 'Failed'}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History Popup */}
      {showHistoryPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-start justify-center p-4 pt-16 sm:pt-24 pb-10 overflow-y-auto">
          <div className="bg-[#0B1120] border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[75vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-800/60">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Previous Downloads
              </h2>
              <div className="flex items-center gap-4">
                {history.length > 0 && (
                  <button onClick={clearHistory} className="text-xs text-rose-400 hover:text-rose-300 font-semibold transition-colors">Clear All</button>
                )}
                <button onClick={() => setShowHistoryPopup(false)} className="text-gray-400 hover:text-white p-1">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="flex flex-col gap-3">
                {history.length === 0 ? (
                  <div className="text-center text-sm text-gray-500 py-8">No previous downloads found.</div>
                ) : (
                  history.map(item => (
                    <div key={item.task_id} className="p-3 pr-4 rounded-xl bg-[#131C31] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-gray-800/50 hover:bg-[#18233C] transition-colors">
                      <div className="flex items-center gap-4 flex-1 min-w-0 w-full sm:w-auto">
                        <div className="w-24 h-14 rounded-lg bg-gray-800 overflow-hidden flex-shrink-0 relative hidden sm:flex items-center justify-center text-xs text-white/50 bg-gradient-to-br from-indigo-900 to-purple-900">
                          Media
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold text-white truncate" title={item.filename}>{item.title}</h4>
                          <div className="text-[11px] text-gray-400 mt-1 flex flex-wrap items-center gap-2">
                            <span className="uppercase font-medium">{item.type === 'video' ? 'MP4' : 'MP3'}</span>
                            <span>•</span>
                            <span>{item.type === 'video' ? '1080p' : '320kbps'}</span>
                            <span>•</span>
                            <span>-- MB</span>
                            <span>•</span>
                            <span>{item.date.split(',')[0]}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between w-full sm:w-auto sm:justify-end gap-4 flex-shrink-0 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-0 border-gray-800">
                        <span className={`px-3 py-1 rounded text-[10px] font-bold ${
                          item.type === 'video' ? 'bg-[#1E1B3B] text-purple-400' : 'bg-[#3B1B1E] text-red-400'
                        }`}>
                          {item.type === 'video' ? 'Video' : 'Audio'}
                        </span>
                        <div className="flex gap-1">
                          <button onClick={() => triggerFileDownload(item.task_id, item.filename)} className="text-purple-500 hover:text-purple-400 hover:bg-purple-500/10 p-2 rounded transition-colors" title="Download File">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                          <button onClick={() => deleteHistoryItem(item.task_id)} className="text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 p-2 rounded transition-colors" title="Remove from History">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-gray-600 border-t border-gray-900 mt-auto">
        <p>© {new Date().getFullYear()} AbsPlay. All rights reserved.</p>
      </footer>

    </div>
  );
}

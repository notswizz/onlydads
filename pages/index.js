import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import Head from 'next/head';

// Prompt options
const DAD_COUNT_OPTIONS = [
  { value: '1', label: '1 old man' },
  { value: '2', label: '2 old men' },
  { value: '3', label: '3 old men' },
];

const POSE_OPTIONS = [
  { value: 'looking', label: 'Looking at model' },
  { value: 'arms_around', label: 'Arms around' },
  { value: 'hands_waist', label: 'Hands on waist' },
  { value: 'hands_shoulders', label: 'Hands on shoulders' },
  { value: 'touching', label: 'Touching/feeling' },
  { value: 'standing_behind', label: 'Standing behind' },
];

const SHIRT_OPTIONS = [
  { value: 'off', label: 'Shirts off' },
  { value: 'unbuttoned', label: 'Unbuttoned' },
  { value: 'tank_top', label: 'Tank tops' },
  { value: 'open_robe', label: 'Open robe' },
];

const RACE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'asian', label: 'Asian' },
  { value: 'latino', label: 'Latino' },
  { value: 'indian', label: 'Indian' },
  { value: 'arab', label: 'Arab' },
];

// Build prompt from options
const buildPrompt = (dadCount, pose, shirt, race) => {
  const raceText = race === 'any' ? '' : `${race} `;
  const count = dadCount === '1' ? `1 ${raceText}old man` : `${dadCount} ${raceText}old men`;
  
  const poseText = {
    'looking': 'looking at the model',
    'arms_around': 'with arms around the model',
    'hands_waist': 'with hands on the model\'s waist',
    'hands_shoulders': 'with hands on the model\'s shoulders',
    'touching': 'touching and feeling the model',
    'standing_behind': 'standing behind the model',
  }[pose] || 'near the model';
  
  const shirtText = {
    'off': 'with their shirts off',
    'unbuttoned': 'with their shirts unbuttoned',
    'tank_top': 'wearing tank tops',
    'open_robe': 'wearing open robes',
  }[shirt] || 'with their shirts off';
  
  return `add ${count} ${shirtText}, ${poseText}. maintain the model's look exactly as in the original photo.`;
};

export default function Home() {
  const { data: session, status } = useSession();
  
  // View state: 'models' | 'model-detail' | 'upload'
  const [view, setView] = useState('models');
  const [selectedModel, setSelectedModel] = useState(null);
  
  // Models list
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  
  // Model detail gallery
  const [gallery, setGallery] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  
  // Upload state
  const [uploadedImage, setUploadedImage] = useState(null);
  const [uploadedImageBase64, setUploadedImageBase64] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  
  // Model input with autocomplete
  const [modelInput, setModelInput] = useState('');
  const [modelSuggestions, setModelSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  // Prompt customization
  const [dadCount, setDadCount] = useState('2');
  const [selectedPose, setSelectedPose] = useState('touching');
  const [shirtStyle, setShirtStyle] = useState('off');
  const [race, setRace] = useState('any');
  
  // Video prompt modal
  const [videoPrompt, setVideoPrompt] = useState('the old men are touching and feeling the model, moving their hands slowly');
  const [videoFrames, setVideoFrames] = useState(81); // 81 frames = ~5 seconds at 16fps
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoModalSource, setVideoModalSource] = useState(null); // gallery item for video
  
  // Jobs queues (background processing)
  const [imageJobs, setImageJobs] = useState([]);
  const [videoJobs, setVideoJobs] = useState([]);
  const [showJobsPanel, setShowJobsPanel] = useState(false);
  
  // Lightbox for viewing images/videos
  const [lightboxItem, setLightboxItem] = useState(null);
  
  // Model search
  const [modelSearch, setModelSearch] = useState('');
  const [showModelsModal, setShowModelsModal] = useState(false);
  
  // Gallery filters
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'image' | 'video'
  const [sortBy, setSortBy] = useState('top'); // 'top' | 'new'
  
  // Homepage feed with infinite scroll
  const [feed, setFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedSort, setFeedSort] = useState('top');
  const [feedType, setFeedType] = useState('all');
  const [feedPage, setFeedPage] = useState(1);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const loadMoreRef = useRef(null);

  // Fetch all models (for autocomplete)
  const fetchModels = useCallback(async () => {
    try {
      setModelsLoading(true);
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.success) setModels(data.models);
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Fetch homepage feed (all content) with pagination
  const fetchFeed = useCallback(async (sort = 'top', type = 'all', page = 1, append = false) => {
    try {
      if (page === 1) {
        setFeedLoading(true);
      } else {
        setFeedLoadingMore(true);
      }
      
      let url = `/api/gallery?limit=20&sort=${sort}&page=${page}`;
      if (type !== 'all') {
        url += `&type=${type}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.success) {
        if (append) {
          setFeed(prev => [...prev, ...data.creations]);
        } else {
          setFeed(data.creations);
        }
        setFeedHasMore(data.pagination.hasMore);
        setFeedPage(page);
      }
    } catch (err) {
      console.error('Failed to fetch feed:', err);
    } finally {
      setFeedLoading(false);
      setFeedLoadingMore(false);
    }
  }, []);

  // Load more feed items
  const loadMoreFeed = useCallback(() => {
    if (!feedLoadingMore && feedHasMore) {
      fetchFeed(feedSort, feedType, feedPage + 1, true);
    }
  }, [feedLoadingMore, feedHasMore, feedSort, feedType, feedPage, fetchFeed]);

  // Fetch gallery for a specific model
  const fetchModelGallery = useCallback(async (modelName, type = 'all', sort = 'top') => {
    try {
      setGalleryLoading(true);
      let url = `/api/gallery?model=${encodeURIComponent(modelName)}&limit=100&sort=${sort}`;
      if (type !== 'all') {
        url += `&type=${type}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) setGallery(data.creations);
    } catch (err) {
      console.error('Failed to fetch gallery:', err);
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  // Fetch model suggestions for autocomplete
  const fetchSuggestions = useCallback(async (search) => {
    if (!search || search.length < 1) {
      setModelSuggestions(models.map(m => m.name));
      return;
    }
    try {
      const res = await fetch(`/api/models?search=${encodeURIComponent(search)}`);
      const data = await res.json();
      if (data.success) {
        setModelSuggestions(data.models.map(m => m.name));
      }
    } catch (err) {
      console.error('Autocomplete error:', err);
    }
  }, [models]);

  useEffect(() => {
    fetchModels();
    fetchFeed();
  }, [fetchModels, fetchFeed]);

  // Handle view changes
  const openModelDetail = (model) => {
    setSelectedModel(model);
    setView('model-detail');
    setTypeFilter('all');
    setSortBy('top');
    fetchModelGallery(model.name, 'all', 'top');
  };
  
  // Refetch gallery when filters change
  const handleFilterChange = (newType, newSort) => {
    if (selectedModel) {
      setTypeFilter(newType);
      setSortBy(newSort);
      fetchModelGallery(selectedModel.name, newType, newSort);
    }
  };

  const openUpload = () => {
    setView('upload');
    reset();
  };

  const goHome = () => {
    setView('models');
    setSelectedModel(null);
    setGallery([]);
    reset();
    fetchModels();
    setFeedPage(1);
    setFeedHasMore(true);
    fetchFeed(feedSort, feedType, 1, false);
    setModelSearch('');
  };

  // Lightbox functions
  const openLightbox = (item) => {
    setLightboxItem(item);
  };

  const closeLightbox = () => {
    setLightboxItem(null);
  };

  // Filter models by search
  const filteredModels = models.filter(model => 
    model.name.toLowerCase().includes(modelSearch.toLowerCase())
  );
  
  // Handle feed filter change (reset to page 1)
  const handleFeedFilterChange = (newSort, newType) => {
    setFeedSort(newSort);
    setFeedType(newType);
    setFeedPage(1);
    setFeedHasMore(true);
    fetchFeed(newSort, newType, 1, false);
  };

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (view !== 'models' || !loadMoreRef.current) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && feedHasMore && !feedLoadingMore && !feedLoading) {
          loadMoreFeed();
        }
      },
      { threshold: 0.1 }
    );
    
    observer.observe(loadMoreRef.current);
    
    return () => observer.disconnect();
  }, [view, feedHasMore, feedLoadingMore, feedLoading, loadMoreFeed]);

  // Handle file upload
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setUploadedImage(URL.createObjectURL(file));
      const reader = new FileReader();
      reader.onloadend = () => setUploadedImageBase64(reader.result);
      reader.readAsDataURL(file);
    }
  };

  // Build the current prompt based on selections
  const currentPrompt = buildPrompt(dadCount, selectedPose, shirtStyle, race);

  // Process an image job in background
  const processImageJob = async (jobId, imageBase64, prompt, modelName) => {
    try {
      // Generate image
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImages: [imageBase64],
          prompt: prompt,
          mode: 'image',
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        // Save to gallery
        const saveRes = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalImage: imageBase64,
            generatedImage: data.output,
            prompt: prompt,
            dadType: 'OnlyDad',
            model: modelName,
            type: 'image',
          }),
        });
        const saveData = await saveRes.json();
        
        if (saveData.success) {
          // Update job status to completed
          setImageJobs(prev => prev.map(job => 
            job.id === jobId 
              ? { ...job, status: 'completed', result: saveData.creation }
              : job
          ));
          // Add to feed
          setFeed(prev => [saveData.creation, ...prev]);
          // Add to gallery if viewing that model
          if (selectedModel?.name === modelName) {
            setGallery(prev => [saveData.creation, ...prev]);
          }
          // Refresh models list
          fetchModels();
        } else {
          throw new Error('Failed to save image');
        }
      } else {
        throw new Error(data.error || 'Image generation failed');
      }
    } catch (err) {
      console.error('Image job failed:', err);
      setImageJobs(prev => prev.map(job => 
        job.id === jobId 
          ? { ...job, status: 'failed', error: err.message }
          : job
      ));
    }
  };

  // Generate image and add to queue
  const handleGenerate = async () => {
    if (!uploadedImageBase64) return;
    if (!modelInput.trim()) {
      setError('Please enter a model name');
      return;
    }
    
    const jobId = Date.now().toString();
    const newJob = {
      id: jobId,
      thumbnail: uploadedImage,
      modelName: modelInput.trim(),
      prompt: currentPrompt,
      status: 'processing',
      result: null,
      error: null,
      createdAt: new Date(),
    };
    
    // Add job to queue
    setImageJobs(prev => [newJob, ...prev]);
    setShowJobsPanel(true);
    
    // Reset upload form and go home
    reset();
    setView('models');
    
    // Process in background
    processImageJob(jobId, uploadedImageBase64, currentPrompt, modelInput.trim());
  };

  // Open video modal for gallery item
  const openVideoModal = (galleryItem) => {
    setVideoModalSource(galleryItem);
    setVideoPrompt('the old men are touching and feeling the model, moving their hands slowly');
    setVideoFrames(81);
    setShowVideoModal(true);
  };

  // Process a video job in background
  const processVideoJob = async (jobId, sourceItem, prompt, numFrames = 81) => {
    try {
      // Generate video
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImages: [sourceItem.generatedImage],
          prompt: prompt,
          mode: 'video',
          numFrames: numFrames,
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        // Save video to gallery
        const saveRes = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalImage: sourceItem.originalImage,
            generatedImage: data.output,
            prompt: prompt,
            dadType: 'OnlyDad',
            model: sourceItem.model,
            type: 'video',
          }),
        });
        const saveData = await saveRes.json();
        
        if (saveData.success) {
          // Update job status to completed
          setVideoJobs(prev => prev.map(job => 
            job.id === jobId 
              ? { ...job, status: 'completed', result: saveData.creation }
              : job
          ));
          // Add to feed if on home
          setFeed(prev => [saveData.creation, ...prev]);
          // Add to gallery if viewing that model
          if (selectedModel?.name === sourceItem.model) {
            setGallery(prev => [saveData.creation, ...prev]);
          }
        } else {
          throw new Error('Failed to save video');
        }
      } else {
        throw new Error(data.error || 'Video generation failed');
      }
    } catch (err) {
      console.error('Video job failed:', err);
      setVideoJobs(prev => prev.map(job => 
        job.id === jobId 
          ? { ...job, status: 'failed', error: err.message }
          : job
      ));
    }
  };

  // Add video to queue and start processing
  const handleMakeVideo = async () => {
    if (!videoPrompt.trim()) return;
    if (!videoModalSource) return;
    
    const jobId = Date.now().toString();
    const frames = videoFrames;
    const newJob = {
      id: jobId,
      sourceItem: videoModalSource,
      prompt: videoPrompt,
      frames: frames,
      status: 'processing', // 'processing' | 'completed' | 'failed'
      result: null,
      error: null,
      createdAt: new Date(),
    };
    
    // Add job to queue
    setVideoJobs(prev => [newJob, ...prev]);
    setShowVideoModal(false);
    setShowJobsPanel(true);
    setVideoModalSource(null);
    
    // Process in background (don't await)
    processVideoJob(jobId, newJob.sourceItem, newJob.prompt, frames);
  };

  // Clear completed/failed jobs
  const clearCompletedJobs = () => {
    setImageJobs(prev => prev.filter(job => job.status === 'processing'));
    setVideoJobs(prev => prev.filter(job => job.status === 'processing'));
  };

  // Handle delete
  const handleDelete = async (creationId) => {
    if (!session) {
      signIn('google');
      return;
    }
    
    if (!confirm('Delete this item?')) return;
    
    try {
      const res = await fetch(`/api/delete?id=${creationId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      
      if (data.success) {
        // Remove from feed and gallery
        setFeed(prev => prev.filter(item => item._id !== creationId));
        setGallery(prev => prev.filter(item => item._id !== creationId));
        // Close lightbox if viewing this item
        if (lightboxItem?._id === creationId) {
          setLightboxItem(null);
        }
      } else {
        alert(data.error || 'Failed to delete');
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete');
    }
  };

  // Handle voting
  const handleVote = async (creationId, voteType) => {
    if (!session) {
      signIn('google');
      return;
    }

    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creationId, voteType }),
      });
      const data = await res.json();
      
      if (data.success) {
        const updateVote = item => 
          item._id === creationId 
            ? { ...item, voteScore: data.voteScore, userVote: data.userVote }
            : item;
        
        // Update both gallery and feed
        setGallery(prev => prev.map(updateVote));
        setFeed(prev => prev.map(updateVote));
      }
    } catch (err) {
      console.error('Vote failed:', err);
    }
  };

  const reset = () => {
    setUploadedImage(null);
    setUploadedImageBase64(null);
    setError(null);
    setModelInput('');
    setShowSuggestions(false);
    setDadCount('2');
    setSelectedPose('touching');
    setShirtStyle('off');
    setRace('any');
    setVideoPrompt('the old men are touching and feeling the model, moving their hands slowly');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle model input change with autocomplete
  const handleModelInputChange = (e) => {
    const value = e.target.value;
    setModelInput(value);
    fetchSuggestions(value);
    setShowSuggestions(true);
  };

  const selectSuggestion = (name) => {
    setModelInput(name);
    setShowSuggestions(false);
  };

  return (
    <>
      <Head>
        <title>OnlyDads 👴</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="theme-color" content="#09090b" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👴</text></svg>" />
      </Head>

      <div className="app">
        {/* Header */}
        <header className="header">
          <h1 className="logo" onClick={goHome}>
            Only<span>Dads</span> 👴
          </h1>
          <div className="header-actions">
            {view !== 'models' && (
              <button className="back-btn" onClick={goHome}>
                ← Home
              </button>
            )}
            {view === 'models' && session && (
              <button className="upload-btn" onClick={openUpload}>
                ✦ Upload
              </button>
            )}
            {status === 'loading' ? (
              <span className="auth-loading">•••</span>
            ) : session ? (
              <div className="user-menu">
                {session.user?.image && (
                  <img src={session.user.image} alt="" className="user-avatar" />
                )}
                <button className="auth-btn logout" onClick={() => signOut()}>
                  Sign Out
                </button>
              </div>
            ) : (
              <button className="auth-btn login" onClick={() => signIn('google')}>
                ✦ Sign In
              </button>
            )}
          </div>
        </header>

        {/* Homepage Feed */}
        {view === 'models' && (
          <section className="feed-section">
            {/* Filter & Sort Controls */}
            <div className="gallery-controls">
              <div className="filter-tabs">
                <button 
                  className={`filter-tab ${feedType === 'all' ? 'active' : ''}`}
                  onClick={() => handleFeedFilterChange(feedSort, 'all')}
                >
                  All
                </button>
                <button 
                  className={`filter-tab ${feedType === 'image' ? 'active' : ''}`}
                  onClick={() => handleFeedFilterChange(feedSort, 'image')}
                >
                  📷 Photos
                </button>
                <button 
                  className={`filter-tab ${feedType === 'video' ? 'active' : ''}`}
                  onClick={() => handleFeedFilterChange(feedSort, 'video')}
                >
                  🎬 Videos
                </button>
              </div>
              <div className="sort-pills">
                <button 
                  className={`sort-pill ${feedSort === 'top' ? 'active' : ''}`}
                  onClick={() => handleFeedFilterChange('top', feedType)}
                >
                  🔥 Top
                </button>
                <button 
                  className={`sort-pill ${feedSort === 'new' ? 'active' : ''}`}
                  onClick={() => handleFeedFilterChange('new', feedType)}
                >
                  ✨ New
                </button>
              </div>
            </div>
            
            {feedLoading ? (
              <p className="loading">loading...</p>
            ) : feed.length === 0 ? (
              <div className="empty-state">
                <p>No content yet</p>
                {session ? (
                  <button className="btn primary" onClick={openUpload}>
                    Upload your first creation
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => signIn('google')}>
                    Sign in to upload
                  </button>
                )}
              </div>
            ) : (
              <div className="gallery-grid">
                {feed.map((item) => (
                  <div key={item._id} className={`gallery-item ${item.type === 'video' ? 'video-item' : ''}`}>
                    {/* Model name badge */}
                    <span className="model-badge" onClick={() => openModelDetail({ name: item.model, count: 0 })}>
                      {item.model}
                    </span>
                    
                    {/* Delete button */}
                    {session && (
                      <button 
                        className="gallery-delete-btn"
                        onClick={(e) => { e.stopPropagation(); handleDelete(item._id); }}
                        title="Delete"
                      >
                        🗑
                      </button>
                    )}
                    
                    {item.type === 'video' ? (
                      <video 
                        src={item.generatedImage} 
                        className="gallery-img clickable" 
                        loop 
                        muted 
                        playsInline
                        onClick={() => openLightbox(item)}
                        onMouseEnter={(e) => e.target.play()}
                        onMouseLeave={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                      />
                    ) : (
                      <>
                        <img 
                          src={item.generatedImage} 
                          alt="" 
                          className="gallery-img clickable" 
                          onClick={() => openLightbox(item)}
                        />
                        <button 
                          className="gallery-video-btn"
                          onClick={(e) => { e.stopPropagation(); openVideoModal(item); }}
                          title="Create video"
                        >
                          ▶
                        </button>
                      </>
                    )}
                    {/* Vote buttons */}
                    <div className="vote-controls">
                      <button 
                        className={`vote-btn upvote ${item.userVote === 'up' ? 'active' : ''}`}
                        onClick={() => handleVote(item._id, 'up')}
                      >
                        ▲
                      </button>
                      <span className={`vote-count ${item.voteScore > 0 ? 'positive' : item.voteScore < 0 ? 'negative' : ''}`}>
                        {item.voteScore || 0}
                      </span>
                      <button 
                        className={`vote-btn downvote ${item.userVote === 'down' ? 'active' : ''}`}
                        onClick={() => handleVote(item._id, 'down')}
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              )}
              
            {/* Infinite scroll trigger */}
            {!feedLoading && feed.length > 0 && (
              <div ref={loadMoreRef} className="load-more-trigger">
                {feedLoadingMore && <p className="loading-more">loading more...</p>}
                {!feedHasMore && feed.length > 0 && <p className="no-more">no more content</p>}
              </div>
            )}
          </section>
        )}

        {/* Model Detail View */}
        {view === 'model-detail' && selectedModel && (
          <section className="model-detail">
            <div className="model-header">
              <h2>{selectedModel.name}</h2>
              <span className="photo-count">{selectedModel.count} items</span>
            </div>
            
            {/* Filter & Sort Controls */}
            <div className="gallery-controls">
              <div className="filter-tabs">
                <button 
                  className={`filter-tab ${typeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => handleFilterChange('all', sortBy)}
                >
                  All
                </button>
                <button 
                  className={`filter-tab ${typeFilter === 'image' ? 'active' : ''}`}
                  onClick={() => handleFilterChange('image', sortBy)}
                >
                  📷 Photos
                </button>
                <button 
                  className={`filter-tab ${typeFilter === 'video' ? 'active' : ''}`}
                  onClick={() => handleFilterChange('video', sortBy)}
                >
                  🎬 Videos
                </button>
              </div>
              <div className="sort-pills">
                <button 
                  className={`sort-pill ${sortBy === 'top' ? 'active' : ''}`}
                  onClick={() => handleFilterChange(typeFilter, 'top')}
                >
                  🔥 Top
                </button>
                <button 
                  className={`sort-pill ${sortBy === 'new' ? 'active' : ''}`}
                  onClick={() => handleFilterChange(typeFilter, 'new')}
                >
                  ✨ New
                </button>
              </div>
            </div>
            
            {galleryLoading ? (
              <p className="loading">loading...</p>
            ) : (
              <div className="gallery-grid">
                {gallery.map((item) => (
                  <div key={item._id} className={`gallery-item ${item.type === 'video' ? 'video-item' : ''}`}>
                    {/* Delete button */}
                    {session && (
                      <button 
                        className="gallery-delete-btn"
                        onClick={(e) => { e.stopPropagation(); handleDelete(item._id); }}
                        title="Delete"
                      >
                        🗑
                      </button>
                    )}
                    
                    {item.type === 'video' ? (
                      <video 
                        src={item.generatedImage} 
                        className="gallery-img clickable" 
                        loop 
                        muted 
                        playsInline
                        onClick={() => openLightbox(item)}
                        onMouseEnter={(e) => e.target.play()}
                        onMouseLeave={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                      />
                    ) : (
                      <>
                        <img 
                          src={item.generatedImage} 
                          alt="" 
                          className="gallery-img clickable" 
                          onClick={() => openLightbox(item)}
                        />
                        <button 
                          className="gallery-video-btn"
                          onClick={(e) => { e.stopPropagation(); openVideoModal(item); }}
                          title="Create video"
                        >
                          ▶
                        </button>
                      </>
                    )}
                    {/* Vote buttons */}
                    <div className="vote-controls">
                      <button 
                        className={`vote-btn upvote ${item.userVote === 'up' ? 'active' : ''}`}
                        onClick={() => handleVote(item._id, 'up')}
                      >
                        ▲
                      </button>
                      <span className={`vote-count ${item.voteScore > 0 ? 'positive' : item.voteScore < 0 ? 'negative' : ''}`}>
                        {item.voteScore || 0}
                      </span>
                      <button 
                        className={`vote-btn downvote ${item.userVote === 'down' ? 'active' : ''}`}
                        onClick={() => handleVote(item._id, 'down')}
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Upload / Generate Section */}
        {view === 'upload' && (
          <section className="generator">
            <>
              <div 
                className="dropzone"
                onClick={() => fileInputRef.current?.click()}
              >
                  {uploadedImage ? (
                    <img src={uploadedImage} alt="Upload" className="preview" />
                  ) : (
                    <div className="dropzone-text">
                      <span>+</span>
                      <p>Drop image or tap to upload</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    hidden
                  />
                </div>

                {uploadedImage && (
                  <>
                    {/* Prompt Customization Options */}
                    <div className="prompt-options">
                      <div className="option-group">
                        <label>How many old men?</label>
                        <div className="option-buttons">
                          {DAD_COUNT_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              className={`option-btn ${dadCount === opt.value ? 'active' : ''}`}
                              onClick={() => setDadCount(opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="option-group">
                        <label>Shirt style</label>
                        <div className="option-buttons">
                          {SHIRT_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              className={`option-btn ${shirtStyle === opt.value ? 'active' : ''}`}
                              onClick={() => setShirtStyle(opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="option-group">
                        <label>Race</label>
                        <div className="option-buttons wrap">
                          {RACE_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              className={`option-btn ${race === opt.value ? 'active' : ''}`}
                              onClick={() => setRace(opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="option-group">
                        <label>Pose</label>
                        <div className="option-buttons wrap">
                          {POSE_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              className={`option-btn ${selectedPose === opt.value ? 'active' : ''}`}
                              onClick={() => setSelectedPose(opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="prompt-preview">
                        <span>Prompt:</span> {currentPrompt}
                      </div>
                    </div>
                    
                    {/* Model Input with Autocomplete */}
                    <div className="prompt-options">
                      <div className="option-group">
                        <label>Model Name</label>
                        <div className="autocomplete-wrapper">
                          <input
                            type="text"
                            value={modelInput}
                            onChange={handleModelInputChange}
                            onFocus={() => { fetchSuggestions(modelInput); setShowSuggestions(true); }}
                            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                            placeholder="Enter model name..."
                            className="model-input"
                          />
                          {showSuggestions && modelSuggestions.length > 0 && (
                            <ul className="suggestions-list">
                              {modelSuggestions.slice(0, 8).map((name) => (
                                <li key={name} onMouseDown={() => selectSuggestion(name)}>
                                  {name}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="actions">
                      <button className="btn primary" onClick={handleGenerate} disabled={!modelInput.trim()}>
                        ✦ Generate & Save
                      </button>
                      <button className="btn secondary" onClick={reset}>Clear</button>
                    </div>
                  </>
                )}

                {error && <p className="error">⚠️ {error}</p>}
              </>
          </section>
        )}

      </div>

      {/* Video Prompt Modal */}
      {showVideoModal && (
        <div className="modal-overlay" onClick={() => setShowVideoModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🎬 Create Video</h3>
              <button className="modal-close" onClick={() => setShowVideoModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <label>Video Prompt</label>
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                placeholder="Describe what should happen in the video..."
                className="video-prompt-input"
                rows={4}
                autoFocus
              />
              <p className="modal-hint">Describe the motion and action you want in the video</p>
              
              <div className="slider-group">
                <label>
                  Duration: <strong>{(videoFrames / 16).toFixed(1)}s</strong> ({videoFrames} frames)
                </label>
                <input
                  type="range"
                  min="81"
                  max="121"
                  step="8"
                  value={videoFrames}
                  onChange={(e) => setVideoFrames(Number(e.target.value))}
                  className="video-slider"
                />
                <div className="slider-labels">
                  <span>~5s</span>
                  <span>~6s</span>
                  <span>~7.5s</span>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setShowVideoModal(false)}>
                Cancel
              </button>
              <button 
                className="btn primary" 
                onClick={handleMakeVideo}
                disabled={!videoPrompt.trim()}
              >
                ✦ Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxItem && (
        <div className="lightbox-overlay" onClick={closeLightbox}>
          <button className="lightbox-close" onClick={closeLightbox}>✕</button>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            {lightboxItem.type === 'video' ? (
              <video 
                src={lightboxItem.generatedImage} 
                className="lightbox-media"
                controls 
                autoPlay 
                loop
              />
            ) : (
              <img 
                src={lightboxItem.generatedImage} 
                alt="" 
                className="lightbox-media"
              />
            )}
            <div className="lightbox-info">
              <span className="lightbox-model" onClick={() => { closeLightbox(); openModelDetail({ name: lightboxItem.model, count: 0 }); }}>
                {lightboxItem.model}
              </span>
              <div className="lightbox-actions">
                <a href={lightboxItem.generatedImage} download className="btn secondary">
                  Download
                </a>
                {lightboxItem.type !== 'video' && (
                  <button 
                    className="btn primary" 
                    onClick={() => { closeLightbox(); openVideoModal(lightboxItem); }}
                  >
                    ✦ Make Video
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Models Floating Button */}
      {view === 'models' && (
        <button 
          className="models-fab"
          onClick={() => setShowModelsModal(true)}
        >
          <span className="models-fab-icon">👤</span>
          <span className="models-fab-label">Models</span>
        </button>
      )}

      {/* Models Modal */}
      {showModelsModal && (
        <div className="modal-overlay" onClick={() => setShowModelsModal(false)}>
          <div className="modal models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>👤 Browse Models</h3>
              <button className="modal-close" onClick={() => setShowModelsModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Search models..."
                className="models-search-input"
                autoFocus
              />
              
              {modelsLoading ? (
                <p className="models-modal-loading">loading...</p>
              ) : filteredModels.length === 0 ? (
                <p className="models-modal-empty">{modelSearch ? 'No matches found' : 'No models yet'}</p>
              ) : (
                <ul className="models-modal-list">
                  {filteredModels.map((model) => (
                    <li 
                      key={model.name}
                      className="models-modal-item"
                      onClick={() => { setShowModelsModal(false); setModelSearch(''); openModelDetail(model); }}
                    >
                      <img src={model.thumbnail} alt="" className="models-modal-thumb" />
                      <div className="models-modal-info">
                        <span className="models-modal-name">{model.name}</span>
                        <span className="models-modal-count">{model.count} {model.count === 1 ? 'post' : 'posts'}</span>
                      </div>
                      <span className="models-modal-arrow">→</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Jobs Floating Button */}
      {(imageJobs.length > 0 || videoJobs.length > 0) && (
        <button 
          className="jobs-fab"
          onClick={() => setShowJobsPanel(!showJobsPanel)}
        >
          <span className="jobs-fab-icon">⚡</span>
          <span className="jobs-fab-count">
            {[...imageJobs, ...videoJobs].filter(j => j.status === 'processing').length || '✓'}
          </span>
        </button>
      )}

      {/* Jobs Panel */}
      {showJobsPanel && (imageJobs.length > 0 || videoJobs.length > 0) && (
        <div className="jobs-panel">
          <div className="jobs-panel-header">
            <h4>Processing Queue</h4>
            <div className="jobs-panel-actions">
              {[...imageJobs, ...videoJobs].some(j => j.status !== 'processing') && (
                <button className="jobs-clear-btn" onClick={clearCompletedJobs}>
                  Clear done
                </button>
              )}
              <button className="jobs-close-btn" onClick={() => setShowJobsPanel(false)}>✕</button>
            </div>
          </div>
          <div className="jobs-list">
            {/* Image Jobs */}
            {imageJobs.map(job => (
              <div key={job.id} className={`job-item job-${job.status}`}>
                <img 
                  src={job.thumbnail} 
                  alt="" 
                  className="job-thumb"
                />
                <div className="job-info">
                  <span className="job-model">{job.modelName}</span>
                  <span className="job-status">
                    {job.status === 'processing' && (
                      <>
                        <span className="job-spinner"></span>
                        Generating image...
                      </>
                    )}
                    {job.status === 'completed' && '✓ Image saved'}
                    {job.status === 'failed' && '✕ Failed'}
                  </span>
                </div>
                <div className="job-actions">
                  {job.status === 'completed' && job.result && (
                    <a 
                      href={job.result.generatedImage} 
                      download 
                      className="job-download"
                      title="Download"
                    >
                      ↓
                    </a>
                  )}
                </div>
              </div>
            ))}
            {/* Video Jobs */}
            {videoJobs.map(job => (
              <div key={job.id} className={`job-item job-${job.status}`}>
                <img 
                  src={job.sourceItem.generatedImage} 
                  alt="" 
                  className="job-thumb"
                />
                <div className="job-info">
                  <span className="job-model">{job.sourceItem.model}</span>
                  <span className="job-status">
                    {job.status === 'processing' && (
                      <>
                        <span className="job-spinner"></span>
                        Creating video...
                      </>
                    )}
                    {job.status === 'completed' && '✓ Video saved'}
                    {job.status === 'failed' && '✕ Failed'}
                  </span>
                </div>
                <div className="job-actions">
                  {job.status === 'completed' && job.result && (
                    <a 
                      href={job.result.generatedImage} 
                      download 
                      className="job-download"
                      title="Download"
                    >
                      ↓
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

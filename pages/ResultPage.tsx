
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Concept, PhotoboothSettings, AspectRatio } from '../types';
import { generateAIImage } from '../lib/gemini';
import { uploadToDrive, createSessionFolder, queueVideoTask } from '../lib/appsScript';
import { applyOverlay } from '../lib/imageUtils';
import { OverlayCache } from '../lib/overlayCache'; 
import { printImage } from '../lib/printUtils';

interface ResultPageProps {
  capturedImage: string;
  concept: Concept;
  settings: PhotoboothSettings;
  concepts: Concept[]; 
  onDone: () => void;
  onGallery: () => void;
  isUltraQuality?: boolean;
  existingSession?: {id: string, url: string} | null;
}

const ResultPage: React.FC<ResultPageProps> = ({ capturedImage, concept: initialConcept, settings, concepts, onDone, onGallery, isUltraQuality = false, existingSession }) => {
  const [concept, setConcept] = useState(initialConcept);
  const [isProcessing, setIsProcessing] = useState(true);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [sessionFolder, setSessionFolder] = useState<{id: string, url: string} | null>(existingSession || null);
  const [photoId, setPhotoId] = useState<string | null>(null); 
  const [viewMode, setViewMode] = useState<'result' | 'original'>('result');
  const [showConceptSelector, setShowConceptSelector] = useState(false);
  const [selectedRegenConcept, setSelectedRegenConcept] = useState<Concept | null>(null);
  const [currentQuality, setCurrentQuality] = useState(isUltraQuality);
  const [pendingQuality, setPendingQuality] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("INITIATING...");
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [isVideoRequested, setIsVideoRequested] = useState(false);
  const [videoRedirectTimer, setVideoRedirectTimer] = useState<number | null>(null);
  const [videoStatusText, setVideoStatusText] = useState("PREPARING REQUEST...");

  let targetWidth = 1080;
  let targetHeight = 1920;
  let displayAspectRatio = '9/16';
  const outputRatio: AspectRatio = settings.outputRatio || '9:16';
  switch (outputRatio) {
    case '16:9': targetWidth = 1920; targetHeight = 1080; displayAspectRatio = '16/9'; break;
    case '9:16': targetWidth = 1080; targetHeight = 1920; displayAspectRatio = '9/16'; break;
    case '3:2': targetWidth = 1800; targetHeight = 1200; displayAspectRatio = '3/2'; break;
    case '2:3': targetWidth = 1200; targetHeight = 1800; displayAspectRatio = '2/3'; break;
  }

  const handleProcessFlow = useCallback(async () => {
    setIsProcessing(true);
    setIsFinalizing(true); 
    setError(null);
    setTimer(0);
    setResultImage(null);
    setPhotoId(null);
    
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setTimer(prev => prev + 1), 1000);

    try {
      const currentSessionId = sessionFolder?.id || existingSession?.id;
      const currentSessionUrl = sessionFolder?.url || existingSession?.url;
      const isRegeneration = !!currentSessionId;

      let sessionTask;
      if (currentSessionId && currentSessionUrl) {
           sessionTask = Promise.resolve({ ok: true, folderId: currentSessionId, folderUrl: currentSessionUrl });
      } else {
           sessionTask = createSessionFolder().then(res => {
              if (res.ok && res.folderId) {
                  setSessionFolder({ id: res.folderId, url: res.folderUrl! });
              }
              return res;
           });
      }

      const originalUploadTask = (!isRegeneration && settings.originalFolderId) 
        ? uploadToDrive(capturedImage, {
             conceptName: "ORIGINAL_CAPTURE",
             eventName: settings.eventName,
             eventId: settings.activeEventId,
             folderId: settings.originalFolderId,
             skipGallery: true 
          })
        : Promise.resolve({ ok: true, id: null });

      const overlayPreloadTask = settings.overlayImage 
        ? OverlayCache.preloadOverlay(settings.overlayImage)
        : Promise.resolve(null);

      setProgress(currentQuality ? "GENERATING ULTRA QUALITY (SLOW)..." : "GENERATING AI VISUALS...");
      const aiOutput = await generateAIImage(capturedImage, concept, outputRatio, currentQuality);

      setProgress("APPLYING FINAL TOUCHES...");
      await overlayPreloadTask;
      const finalImage = await applyOverlay(aiOutput, settings.overlayImage, targetWidth, targetHeight);
      
      setResultImage(finalImage);
      setIsProcessing(false);
      if (timerRef.current) clearInterval(timerRef.current);

      const sessionRes = await sessionTask;
      const originalRes = await originalUploadTask;

      if (!sessionRes.ok || !sessionRes.folderId) {
          throw new Error("Gagal membuat/akses folder sesi.");
      }

      const uploadRes = await uploadToDrive(finalImage, {
          conceptName: concept.name,
          eventName: settings.eventName,
          eventId: settings.activeEventId,
          folderId: sessionRes.folderId, 
          originalId: originalRes.id,
          sessionFolderId: sessionRes.folderId,
          sessionFolderUrl: sessionRes.folderUrl
      });

      if (uploadRes.ok) {
        setPhotoId(uploadRes.id);
      }
      
      setIsFinalizing(false);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Processing Failed");
      setIsProcessing(false);
      setIsFinalizing(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [capturedImage, concept, settings, outputRatio, currentQuality, existingSession]);

  useEffect(() => {
    handleProcessFlow();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [handleProcessFlow]); 

  // FIXED: Trigger queueing instead of direct generate and AWAIT RESPONSE
  const handleGenerateVideo = async () => {
    if (!photoId) return;
    setIsVideoRequested(true);
    setVideoStatusText("CONNECTING TO SERVER...");

    try {
       // Explicitly pass settings to avoid missing parameters in backend
       const res = await queueVideoTask(photoId, {
           prompt: settings.videoPrompt,
           resolution: settings.videoResolution || '480p',
           model: settings.videoModel || 'seedance-1-0-pro-fast-251015'
       });

       if (!res.ok) {
           throw new Error("Queue failed, trying direct API...");
       }
       
       setVideoStatusText("VIDEO QUEUED SUCCESSFULLY");
       console.log("Video task queued successfully");

    } catch(e) { 
       console.warn("Queue failed, attempting fallback...", e);
       setVideoStatusText("TRYING DIRECT RENDER...");
       
       // Fallback: Direct API Call if Sheet Queue fails
       // AWAIT this fetch to ensure it sends before page unmounts
       try {
           await fetch('/api/video/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                 driveFileId: photoId,
                 prompt: settings.videoPrompt,
                 resolution: settings.videoResolution || '480p',
                 model: settings.videoModel // Ensure model is passed
              })
           });
           setVideoStatusText("RENDER STARTED");
       } catch (err) {
           console.error("Fallback failed", err);
           setVideoStatusText("REQUEST SENT (CHECK GALLERY)");
       }
    }

    // Start Redirect Countdown AFTER request attempts are done
    let countdown = 3;
    setVideoRedirectTimer(countdown);
    
    const intv = setInterval(() => {
       countdown--;
       setVideoRedirectTimer(countdown);
       if (countdown <= 0) {
          clearInterval(intv);
          onDone(); 
       }
    }, 1000);
  };

  const handleRegenerateClick = () => {
      setPendingQuality(currentQuality);
      setShowConceptSelector(true);
  };
  
  const executeRegeneration = () => {
    if (selectedRegenConcept) {
        setCurrentQuality(pendingQuality);
        setConcept(selectedRegenConcept);
        setShowConceptSelector(false);
    }
  };

  const handlePrint = () => {
      if (resultImage) printImage(resultImage);
  };

  if (isProcessing) {
    return (
      <div className="w-full h-[100dvh] flex flex-col items-center justify-center relative p-6 text-center overflow-hidden bg-black/90 backdrop-blur-md">
        <div className="absolute inset-0 z-0 flex items-center justify-center p-4">
          <img src={capturedImage} className="max-w-full max-h-full object-contain opacity-50 blur-lg" alt="Preview" />
          <div className="absolute inset-0 bg-black/60" />
        </div>
        <div className="relative z-10 flex flex-col items-center">
          <div className="relative w-40 h-40 md:w-64 md:h-64 mb-8 shrink-0">
             <div className="absolute inset-0 border-[6px] border-white/5 rounded-full" />
             <div className="absolute inset-0 border-[6px] border-t-purple-500 rounded-full animate-spin shadow-[0_0_30px_rgba(188,19,254,0.4)]" />
             <div className="absolute inset-0 flex items-center justify-center flex-col">
               <span className="text-[10px] tracking-[0.3em] text-purple-400 font-bold mb-1 uppercase italic">Processing</span>
               <span className="text-3xl md:text-5xl font-heading text-white italic">{timer}S</span>
             </div>
          </div>
          <div className="max-w-md bg-black/40 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-2xl">
            <h2 className="text-xl md:text-2xl font-heading mb-3 neon-text italic uppercase tracking-tighter">{progress}</h2>
            <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mb-3">
              <div className="bg-purple-500 h-full animate-[progress_10s_ease-in-out_infinite]" style={{width: '60%'}} />
            </div>
            <p className="text-[8px] text-gray-500 uppercase tracking-widest animate-pulse">Initializing Generative AI System...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isVideoRequested) {
    return (
      <div className="w-full h-[100dvh] flex flex-col items-center justify-center bg-black/90 p-8 text-center animate-[fadeIn_0.5s] backdrop-blur-xl">
          <div className="w-24 h-24 mb-6 rounded-full border-4 border-purple-500/50 flex items-center justify-center bg-purple-900/20 shadow-[0_0_50px_rgba(168,85,247,0.3)]">
             <svg className="w-12 h-12 text-purple-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </div>
          <h1 className="text-3xl md:text-5xl font-heading text-white italic uppercase tracking-tighter mb-4">VIDEO INITIATED</h1>
          <p className="text-white/60 font-mono text-sm tracking-widest uppercase mb-8 max-w-lg leading-relaxed">
             {videoStatusText}
          </p>
          {videoRedirectTimer !== null && (
             <div className="text-purple-400 font-bold tracking-[0.2em] text-xs">REDIRECTING IN {videoRedirectTimer}...</div>
          )}
      </div>
    );
  }

  if (error) {
     return (
       <div className="w-full h-[100dvh] flex flex-col items-center justify-center bg-transparent text-center p-10">
         <h2 className="text-red-500 text-2xl font-heading mb-4 italic">SYSTEM ERROR</h2>
         <p className="text-gray-500 mb-8 font-mono text-xs">{error}</p>
         <button onClick={handleProcessFlow} className="px-8 py-3 bg-white text-black font-heading uppercase italic tracking-widest">RETRY PROCESS</button>
       </div>
     )
  }

  return (
    <div className="w-full h-[100dvh] flex flex-col bg-transparent overflow-hidden relative font-sans">
      <div className="relative z-10 w-full h-full flex flex-col items-center p-4 md:p-6 gap-6">
         <div className="flex-1 w-full min-h-0 flex items-center justify-center">
            <div className="relative border-4 border-white/5 shadow-2xl bg-black/50 backdrop-blur-sm rounded-xl overflow-hidden" style={{ aspectRatio: displayAspectRatio, maxHeight: '100%', maxWidth: '100%' }}>
                <img src={viewMode === 'result' ? resultImage! : capturedImage} className="w-full h-full object-cover" />
                <div className="absolute top-4 right-4 z-40">
                    <button onClick={() => setViewMode(prev => prev === 'result' ? 'original' : 'result')} className={`backdrop-blur border px-4 py-2 rounded-full font-bold text-[10px] uppercase tracking-widest transition-all ${viewMode === 'result' ? 'bg-purple-900/50 border-purple-500 text-purple-200' : 'bg-green-900/50 border-green-500 text-green-200'}`}>
                      {viewMode === 'result' ? '👁 VIEW ORIGINAL' : '✨ VIEW RESULT'}
                    </button>
                </div>
                <div className="absolute bottom-4 left-0 right-0 flex justify-center items-center gap-3 z-30 px-2 flex-wrap">
                   <button onClick={() => setShowQR(true)} disabled={!sessionFolder} className={`backdrop-blur-md border px-5 py-4 rounded-full font-heading text-[10px] tracking-[0.2em] uppercase italic flex items-center gap-2 transition-all ${!sessionFolder ? 'bg-gray-800/50 border-gray-600 text-gray-400 cursor-wait' : 'bg-purple-900/30 border-purple-500/50 text-purple-100 hover:bg-purple-600/40'}`}>
                      {!sessionFolder ? "SAVING..." : "SESSION QR"}
                   </button>
                   {settings.enablePrint && (
                       <button onClick={handlePrint} className="backdrop-blur-md bg-cyan-900/30 border border-cyan-500/50 text-cyan-100 px-5 py-4 rounded-full font-heading text-[10px] tracking-[0.2em] uppercase italic flex items-center gap-2 hover:bg-cyan-600/40 shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all">
                          PRINT
                       </button>
                   )}
                   <button onClick={handleRegenerateClick} className="backdrop-blur-md bg-orange-900/30 border border-orange-500/50 text-orange-100 px-5 py-4 rounded-full font-heading text-[10px] tracking-[0.2em] uppercase italic flex items-center gap-2 hover:bg-orange-600/40 transition-all">
                      REGENERATE
                   </button>
                   {settings.boothMode === 'video' && (
                      <button onClick={handleGenerateVideo} disabled={!photoId} className={`backdrop-blur-md border px-5 py-4 rounded-full font-heading text-[10px] tracking-[0.2em] uppercase italic flex items-center gap-2 shadow-[0_0_20px_rgba(37,99,235,0.4)] ${!photoId ? 'bg-gray-800/50 border-gray-600 text-gray-400 cursor-wait' : 'bg-blue-900/30 border-blue-500/50 text-blue-100 hover:bg-blue-600/40 animate-pulse'}`}>
                         {!photoId ? "SYNCING..." : "GENERATE VIDEO"}
                      </button>
                   )}
                </div>
            </div>
         </div>
         <div className="relative z-10 flex flex-col items-center gap-2 pb-6">
             <button onClick={onDone} className="text-gray-500 hover:text-white uppercase tracking-widest text-xs transition-colors flex items-center gap-2">
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                 Start Over
             </button>
         </div>
      </div>

      {showConceptSelector && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6 animate-[fadeIn_0.2s]">
             <div className="bg-[#0a0a0a] border border-white/10 rounded-xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl relative">
                 <div className="p-6 border-b border-white/10 flex justify-between items-center bg-black/50">
                    <h2 className="text-xl font-heading text-white neon-text uppercase italic">Select New Concept</h2>
                    <button onClick={() => setShowConceptSelector(false)} className="text-white/50 hover:text-white">✕</button>
                 </div>
                 <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 md:grid-cols-3 gap-4">
                    {concepts.map(c => (
                      <div key={c.id} onClick={() => setSelectedRegenConcept(c)} className={`relative group cursor-pointer rounded-lg overflow-hidden border transition-all ${selectedRegenConcept?.id === c.id ? 'border-orange-500 ring-2 ring-orange-500/50' : 'border-white/10 hover:border-purple-500'}`}>
                         <img src={c.thumbnail} className="w-full h-40 object-cover transition-transform group-hover:scale-105" />
                         {selectedRegenConcept?.id === c.id && (
                             <div className="absolute inset-0 bg-orange-500/20 flex items-center justify-center">
                                 <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center shadow-lg"><svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg></div>
                             </div>
                         )}
                         <div className="absolute bottom-0 inset-x-0 bg-black/80 p-2 text-center"><p className="text-[10px] text-white font-bold uppercase truncate">{c.name}</p></div>
                      </div>
                    ))}
                 </div>
                 <div className="p-6 border-t border-white/10 flex flex-col md:flex-row justify-between gap-4 bg-black/50">
                    <label className="flex items-center gap-3 cursor-pointer group select-none">
                       <div className={`w-5 h-5 border rounded flex items-center justify-center transition-all ${pendingQuality ? 'bg-purple-600 border-purple-500' : 'bg-black/50 border-white/20 group-hover:border-purple-400'}`}>
                           {pendingQuality && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                       </div>
                       <input type="checkbox" className="hidden" checked={pendingQuality} onChange={e => setPendingQuality(e.target.checked)} />
                       <div className="flex flex-col">
                          <span className={`text-xs font-bold uppercase tracking-widest ${pendingQuality ? 'text-purple-300' : 'text-gray-400 group-hover:text-white'}`}>USE ULTRA QUALITY</span>
                          <span className="text-[8px] text-gray-500">Warning: Slower generation time</span>
                       </div>
                    </label>
                    <div className="flex gap-4">
                        <button onClick={() => setShowConceptSelector(false)} className="px-6 py-3 rounded-lg text-white/50 hover:text-white text-xs font-bold uppercase tracking-widest">Cancel</button>
                        <button onClick={executeRegeneration} disabled={!selectedRegenConcept} className="px-8 py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-heading text-xs tracking-widest uppercase rounded shadow-[0_0_20px_rgba(234,88,12,0.3)] transition-all">Confirm Regenerate</button>
                    </div>
                 </div>
             </div>
         </div>
      )}

      {showQR && sessionFolder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-[fadeIn_0.3s]" onClick={() => setShowQR(false)}>
            <div className="relative bg-[#050505]/95 border border-purple-500/50 p-6 rounded-2xl flex flex-col items-center gap-4 max-w-[280px] w-full shadow-[0_0_80px_rgba(168,85,247,0.4)] backdrop-blur-xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="absolute top-0 left-0 w-full h-1 bg-purple-400/50 shadow-[0_0_10px_#a855f7] animate-[scan_2s_linear_infinite] z-20 pointer-events-none opacity-70" />
                <div className="flex flex-col items-center z-10 w-full">
                  <h3 className="text-white font-heading text-xs tracking-[0.3em] uppercase neon-text">Neural Link</h3>
                  <div className="w-full h-px bg-gradient-to-r from-transparent via-purple-500 to-transparent mt-2 opacity-50"/>
                </div>
                <div className="relative p-3 bg-white rounded-xl z-10 shadow-inner mt-1">
                  <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-purple-500" />
                  <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-purple-500" />
                  <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-purple-500" />
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-purple-500" />
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(sessionFolder.url)}`} className="w-32 h-32 object-contain mix-blend-multiply" />
                </div>
                <div className="text-center z-10 mt-1">
                  <p className="text-purple-300 text-[9px] font-mono tracking-widest uppercase mb-1">SCAN_TO_DOWNLOAD</p>
                  <p className="text-gray-500 text-[7px] uppercase tracking-widest">SECURE_CONNECTION_ESTABLISHED</p>
                </div>
                <button onClick={() => setShowQR(false)} className="mt-2 w-full py-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 font-bold uppercase text-[9px] tracking-[0.2em] rounded transition-colors z-10">CLOSE</button>
            </div>
          </div>
      )}

      <style>{`
        @keyframes progress { 0% { width: 0%; } 100% { width: 100%; } }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes scan { 0% { top: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
      `}</style>
    </div>
  );
};

export default ResultPage;

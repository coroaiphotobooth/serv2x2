
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AspectRatio, PhotoboothSettings } from '../types';

interface CameraPageProps {
  onCapture: (image: string) => void;
  onGenerate: () => void;
  onBack: () => void;
  capturedImage: string | null;
  orientation: 'portrait' | 'landscape';
  cameraRotation?: number; // 0, 90, 180, 270
  aspectRatio?: AspectRatio; // '9:16' | '16:9' etc
  settings?: PhotoboothSettings; 
  onUpdateSettings?: (settings: PhotoboothSettings) => void; 
}

const CameraPage: React.FC<CameraPageProps> = ({ 
    onCapture, 
    onGenerate, 
    onBack, 
    capturedImage, 
    orientation, 
    cameraRotation = 0,
    aspectRatio = '9:16',
    settings,
    onUpdateSettings
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null); 
  
  const [countdown, setCountdown] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMirrored, setIsMirrored] = useState(true); 

  // --- CAMERA CONTROL FUNCTIONS ---

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      console.log("Stopping Camera Stream...");
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        streamRef.current?.removeTrack(track);
      });
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load(); 
    }
    setIsStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current) stopCamera();
    setCameraError(null);

    try {
      console.log("Starting Camera (Max Resolution/Full Frame)...");
      const constraints: MediaStreamConstraints = { 
        audio: false,
        video: { 
          // Requesting 4K/Max to ensure we get the full sensor FOV without driver-side cropping
          width: { ideal: 3840 }, 
          height: { ideal: 2160 }, 
          facingMode: 'user'
        } 
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = mediaStream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(e => console.warn("Autoplay blocked:", e));
      }
      setIsStreaming(true);
    } catch (err: any) {
      console.error("Camera Setup Error:", err);
      let msg = "Failed to access camera.";
      if (err.name === 'NotAllowedError') msg = "Permission denied. Please allow camera access.";
      else if (err.name === 'NotFoundError') msg = "No camera device found.";
      else if (err.name === 'NotReadableError') msg = "Camera is busy.";
      setCameraError(msg);
    }
  }, [stopCamera]);

  // --- LIFECYCLE MANAGEMENT ---

  useEffect(() => {
    startCamera();
    const handleVisibilityChange = () => {
        if (document.hidden) {
            stopCamera();
        } else {
            if (!capturedImage) startCamera();
        }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopCamera();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [startCamera, stopCamera, capturedImage]);

  // --- CAPTURE LOGIC (Revised for Center Crop / Object Cover) ---

  const getAspectRatioValue = (ratioStr: string): number => {
    const [w, h] = ratioStr.split(':').map(Number);
    return w / h;
  };
  const targetRatioValue = getAspectRatioValue(aspectRatio);

  const capture = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const rawW = video.videoWidth;
      const rawH = video.videoHeight;
      
      if (rawW === 0 || rawH === 0) return;

      // 1. Determine Output Size (Max 1536px)
      const MAX_DIMENSION = 1536;
      let destW, destH;

      if (targetRatioValue < 1) { // Portrait Output
          destW = Math.round(MAX_DIMENSION * targetRatioValue);
          destH = MAX_DIMENSION;
      } else { // Landscape Output
          destW = MAX_DIMENSION;
          destH = Math.round(MAX_DIMENSION / targetRatioValue);
      }

      // 2. Set Canvas Size
      canvas.width = destW;
      canvas.height = destH;

      if (ctx) {
         ctx.save();
         
         // 3. Setup Context for Rotation/Mirroring
         // Translate to center of canvas
         ctx.translate(destW / 2, destH / 2);
         // Rotate context (if camera is mounted sideways)
         ctx.rotate((cameraRotation * Math.PI) / 180);
         // Mirror (Flip horizontally)
         ctx.scale(isMirrored ? -1 : 1, 1); 

         // 4. Calculate Draw Dimensions (Object Cover Logic)
         // Note: If context is rotated 90deg, the "width" the video sees is actually destH
         const isRotated = cameraRotation % 180 !== 0;
         const canvasWidthSeenByVideo = isRotated ? destH : destW;
         const canvasHeightSeenByVideo = isRotated ? destW : destH;

         // Calculate scale to COVER the canvas area
         const scale = Math.max(canvasWidthSeenByVideo / rawW, canvasHeightSeenByVideo / rawH);
         
         const drawW = rawW * scale;
         const drawH = rawH * scale;
         
         // Center the video draw relative to the translated center
         const offsetX = -drawW / 2;
         const offsetY = -drawH / 2;

         ctx.drawImage(video, offsetX, offsetY, drawW, drawH);

         ctx.restore();

         // Export as High Quality JPEG
         const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
         stopCamera();
         onCapture(dataUrl);
         onGenerate();
      }
    }
  }, [onCapture, onGenerate, cameraRotation, targetRatioValue, stopCamera, isMirrored]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCamera();

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          const imgRatio = img.width / img.height;
          let sX = 0, sY = 0, sW = img.width, sH = img.height;
          
          // Center crop logic for upload
          if (imgRatio > targetRatioValue) {
             sW = img.height * targetRatioValue;
             sX = (img.width - sW) / 2;
          } else {
             sH = img.width / targetRatioValue;
             sY = (img.height - sH) / 2;
          }

          const MAX_DIMENSION = 1536;
          let dW, dH;
          if (targetRatioValue < 1) {
              dW = Math.round(MAX_DIMENSION * targetRatioValue);
              dH = MAX_DIMENSION;
          } else {
              dW = MAX_DIMENSION;
              dH = Math.round(MAX_DIMENSION / targetRatioValue);
          }

          canvas.width = dW;
          canvas.height = dH;

          if (ctx) {
            ctx.drawImage(img, sX, sY, sW, sH, 0, 0, dW, dH);
            // Export as High Quality JPEG
            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            onCapture(dataUrl);
            onGenerate();
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const startCountdown = () => {
    if (!isStreaming && !streamRef.current) {
        startCamera().then(() => doCountdown());
    } else {
        doCountdown();
    }
  };

  const doCountdown = () => {
      setCountdown(3);
      const interval = setInterval(() => {
        setCountdown(prev => {
          if (prev === 1) {
            clearInterval(interval);
            capture();
            return null;
          }
          return prev ? prev - 1 : null;
        });
      }, 1000);
  };

  const handleBack = () => {
      stopCamera(); 
      onBack();
  };

  const handleToggleModel = () => {
      if (!settings || !onUpdateSettings) return;
      const isUltra = settings.selectedModel === 'gemini-3-pro-image-preview';
      const newModel = isUltra ? 'gemini-2.5-flash-image' : 'gemini-3-pro-image-preview';
      onUpdateSettings({ ...settings, selectedModel: newModel });
  };

  // Convert "9:16" -> "9/16" for CSS aspect-ratio
  const cssAspectRatio = aspectRatio.replace(':', '/');
  
  // Logic to bias container dimensions to avoid 0x0 collapse
  // If Portrait Ratio (< 1): Height is primary (100%), Width auto
  // If Landscape Ratio (> 1): Width is primary (100%), Height auto
  const isTall = targetRatioValue < 1;
  
  const showModelShortcut = settings?.enableModelShortcut;
  const isUltraModel = settings?.selectedModel === 'gemini-3-pro-image-preview';

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-transparent relative overflow-hidden">
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-40 bg-gradient-to-b from-black/80 to-transparent">
        <button 
          onClick={handleBack} 
          className="text-white hover:text-purple-400 font-bold tracking-widest uppercase text-xs md:text-base transition-colors bg-black/20 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10"
        >
          BACK
        </button>
        <h2 className="text-sm md:text-2xl font-heading text-white neon-text italic uppercase drop-shadow-lg">Strike a Pose</h2>
        
        <button 
            onClick={() => setIsMirrored(prev => !prev)}
            className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-black/20 backdrop-blur-sm border border-white/10 text-white hover:bg-white/10 hover:text-purple-400 transition-all shadow-lg"
            title={isMirrored ? "Disable Mirror" : "Enable Mirror"}
        >
            {isMirrored ? (
               <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            ) : (
               <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            )}
        </button>
      </div>

      {/* VIEWPORT MASK CONTAINER */}
      <div className="relative z-10 flex items-center justify-center w-full h-full max-h-screen p-4 md:p-8">
        
        {/* CAMERA ERROR UI */}
        {cameraError && !capturedImage && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
                 <div className="bg-red-900/20 border border-red-500/50 p-6 rounded-xl text-center max-w-sm backdrop-blur-md">
                     <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                         <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                     </div>
                     <h3 className="text-white font-heading uppercase tracking-widest mb-2">Camera Error</h3>
                     <p className="text-gray-300 text-xs font-mono mb-6">{cameraError}</p>
                     <button onClick={startCamera} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white font-bold uppercase text-xs rounded transition-colors">
                         Retry Camera
                     </button>
                 </div>
             </div>
        )}

        {!capturedImage ? (
           /* PREVIEW WRAPPER */
           <div 
             className="relative overflow-hidden shadow-[0_0_50px_rgba(168,85,247,0.2)] border-2 border-purple-500/30 rounded-xl bg-gray-900 flex items-center justify-center"
             style={{
                aspectRatio: cssAspectRatio,
                // Ensure dimensions are applied based on orientation to prevent 0x0 collapse
                height: isTall ? '100%' : 'auto',     
                width: isTall ? 'auto' : '100%',      
                maxHeight: '100%',
                maxWidth: '100%'
             }}
           >
              {/* VIDEO ELEMENT */}
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted
                onLoadedMetadata={(e) => {
                    const v = e.target as HTMLVideoElement;
                    v.play().catch(console.error);
                }}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ 
                   transform: `rotate(${cameraRotation}deg) scaleX(${isMirrored ? -1 : 1})`,
                   transformOrigin: 'center center'
                }}
              />

              {/* HUD / Countdown Overlay */}
              <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center opacity-40">
                   <div className="w-1/2 h-1/3 border border-white/30 rounded-lg flex items-center justify-center">
                       <div className="w-2 h-2 bg-purple-500/50 rounded-full" />
                   </div>
              </div>

              {countdown && (
                <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-[4px]">
                  <span className="text-[120px] md:text-[250px] font-heading text-white neon-text animate-ping italic">{countdown}</span>
                </div>
              )}
           </div>
        ) : (
           /* CAPTURE RESULT PREVIEW */
           <div 
             className="relative overflow-hidden border-2 border-white/20 rounded-xl"
             style={{
                aspectRatio: cssAspectRatio,
                height: isTall ? '100%' : 'auto',     
                width: isTall ? 'auto' : '100%',      
                maxHeight: '100%',
                maxWidth: '100%'
             }}
           >
              <img src={capturedImage} alt="Capture" className="w-full h-full object-contain bg-black" />
           </div>
        )}
      </div>

      {/* CONTROLS */}
      {!countdown && !capturedImage && (
        <div className="absolute bottom-10 left-0 right-0 flex justify-center items-center z-50 px-6 gap-8 pointer-events-none">
                
                {/* QUICK MODEL SHORTCUT TOGGLE (LEFT) */}
                <div className="w-16 h-16 md:flex items-center justify-center pointer-events-auto">
                   {showModelShortcut && (
                       <button
                         onClick={handleToggleModel}
                         className={`group flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full backdrop-blur-md border-2 transition-all shadow-lg ${isUltraModel ? 'bg-orange-900/40 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'bg-purple-900/40 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.4)]'}`}
                       >
                           <div className={`text-[8px] md:text-[9px] font-bold font-heading uppercase tracking-widest ${isUltraModel ? 'text-orange-200' : 'text-purple-200'}`}>
                               {isUltraModel ? 'ULTRA' : 'NORMAL'}
                           </div>
                           <div className={`text-[6px] md:text-[7px] font-mono opacity-70 ${isUltraModel ? 'text-orange-300' : 'text-purple-300'}`}>
                               {isUltraModel ? 'GEN3' : 'GEN2.5'}
                           </div>
                       </button>
                   )}
                </div>

                <button 
                  onClick={startCountdown}
                  className="group pointer-events-auto relative w-24 h-24 md:w-28 md:h-28 flex items-center justify-center outline-none transition-transform active:scale-95"
                  disabled={!!cameraError}
                >
                  <div className={`absolute inset-0 border-2 border-dashed ${cameraError ? 'border-red-500/30' : 'border-purple-500/30'} rounded-full animate-[spin_10s_linear_infinite]`} />
                  <div className={`absolute inset-2 border-2 ${cameraError ? 'border-red-500/20' : 'border-white/20'} rounded-full group-hover:border-purple-400/50 transition-colors duration-500`} />
                  <div className={`absolute inset-4 bg-white/5 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center group-hover:bg-purple-600/20 group-hover:border-purple-400 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.05)]`}>
                    <span className="text-[10px] md:text-xs font-heading font-black text-white tracking-[0.2em] italic group-hover:neon-text">CAPTURE</span>
                  </div>
                </button>

                <div className="pointer-events-auto w-16 h-16 md:flex items-center justify-center">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-black/40 border border-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/10 hover:border-purple-500 transition-all group/upload"
                    title="Upload Image"
                  >
                    <svg className="w-5 h-5 md:w-6 md:h-6 text-white/70 group-hover/upload:text-purple-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  </button>
                  <input 
                    type="file" 
                    accept="image/*" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload} 
                  />
                </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default CameraPage;

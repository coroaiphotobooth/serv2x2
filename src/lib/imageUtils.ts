
import { OverlayCache } from './overlayCache';

/**
 * Mengubah URL Google Drive biasa menjadi Direct Link yang ramah CDN (lh3).
 * URL lh3 jauh lebih cepat dan tidak kena limit 403 Forbidden di tag <img>.
 */
export const getGoogleDriveDirectLink = (url: string | null): string => {
  if (!url) return '';
  if (url.startsWith('data:')) return url; // Base64 pass through

  // Regex untuk menangkap ID file dari berbagai format URL Drive
  const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  
  if (match && match[1]) {
    // Format lh3.googleusercontent.com/d/{ID} memaksa download/render gambar langsung
    return `https://lh3.googleusercontent.com/d/${match[1]}`;
  }
  
  return url;
};

export const applyOverlay = async (
    base64AI: string, 
    overlayUrl: string | null, 
    targetWidth: number, 
    targetHeight: number
  ): Promise<string> => {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas context unavailable");
  
    // Helper Load Base Image (Tetap manual karena base64AI selalu berubah per user)
    const loadBaseImg = (src: string): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Base image load error"));
        img.src = src;
      });
    };
  
    try {
      // 1. Load Generated AI Image
      const baseImg = await loadBaseImg(base64AI);
      
      // Calculate Aspect Fit/Fill
      const scale = Math.max(targetWidth / baseImg.width, targetHeight / baseImg.height);
      const x = (targetWidth / 2) - (baseImg.width / 2) * scale;
      const y = (targetHeight / 2) - (baseImg.height / 2) * scale;
      
      // Draw Base
      ctx.drawImage(baseImg, x, y, baseImg.width * scale, baseImg.height * scale);
  
      // 2. Draw Overlay from Cache (Optimized)
      if (overlayUrl && overlayUrl.trim() !== '') {
          try {
             // Panggil cache. Jika sudah ada di memori, ini instant (sync-like speed).
             // Jika belum, akan fetch sekali lalu simpan.
             const cachedOverlay = await OverlayCache.preloadOverlay(overlayUrl);
             
             if (cachedOverlay) {
                 ctx.drawImage(cachedOverlay, 0, 0, targetWidth, targetHeight);
             }
          } catch (e) {
             console.warn("Failed to apply overlay from cache:", e);
          }
      }

      return canvas.toDataURL('image/jpeg', 0.92);
    } catch (err) {
      console.error("Canvas composition error:", err);
      // Return original if composition fails
      return base64AI;
    }
  };


/**
 * OVERLAY CACHE SYSTEM
 * Mengoptimalkan penggunaan memori dan CPU dengan menyimpan overlay yang sudah didecode.
 * Menggunakan ImageBitmap (GPU Friendly) jika didukung browser.
 */

// Helper lokal untuk URL (Duplikasi dari imageUtils untuk menghindari Circular Dependency)
const resolveOverlayUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://lh3.googleusercontent.com/d/${match[1]}`;
    }
    return url;
};

class OverlayCacheSystem {
    private cache: ImageBitmap | HTMLImageElement | null = null;
    private currentUrl: string | null = null;
    private pendingPromise: Promise<ImageBitmap | HTMLImageElement> | null = null;

    /**
     * Memuat overlay dari URL. 
     * Jika URL sama dengan cache, kembalikan cache (Instant).
     * Jika URL berbeda, fetch baru dan ganti cache.
     */
    async preloadOverlay(rawUrl: string | null): Promise<ImageBitmap | HTMLImageElement | null> {
        if (!rawUrl || rawUrl.trim() === '') {
            this.clearCache();
            return null;
        }

        const url = resolveOverlayUrl(rawUrl);

        // 1. Check Cache Hit
        if (this.currentUrl === url && this.cache) {
            console.log(`[OVERLAY] Cache HIT: ${url.substring(0, 30)}...`);
            return this.cache;
        }

        // 2. Check Pending Request (Deduping)
        if (this.currentUrl === url && this.pendingPromise) {
            console.log(`[OVERLAY] Awaiting pending load...`);
            return this.pendingPromise;
        }

        console.log(`[OVERLAY] Preload START: ${url.substring(0, 30)}...`);
        this.currentUrl = url;

        this.pendingPromise = new Promise(async (resolve, reject) => {
            try {
                // Fetch Blob
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch overlay: ${response.statusText}`);
                const blob = await response.blob();

                // Clear Old Cache (Prevent Memory Leak)
                if (this.cache && this.cache instanceof ImageBitmap) {
                    this.cache.close(); // Penting untuk membebaskan VRAM/RAM
                }
                this.cache = null;

                // Decode Image
                let image: ImageBitmap | HTMLImageElement;
                if ('createImageBitmap' in window) {
                    // Modern Way (Off-main-thread decoding, GPU ready)
                    image = await createImageBitmap(blob);
                } else {
                    // Fallback Way
                    image = await this.loadImageElement(blob);
                }

                this.cache = image;
                console.log(`[OVERLAY] Preload DONE. Type: ${image instanceof ImageBitmap ? 'ImageBitmap' : 'img element'}`);
                resolve(image);

            } catch (error) {
                console.error("[OVERLAY] Load Error:", error);
                // Reset state on error so we can try again later
                this.currentUrl = null; 
                this.cache = null;
                reject(error);
            } finally {
                this.pendingPromise = null;
            }
        });

        return this.pendingPromise;
    }

    private loadImageElement(blob: Blob): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Image element load failed"));
            };
            img.src = url;
        });
    }

    getOverlay() {
        return this.cache;
    }

    clearCache() {
        if (this.cache && this.cache instanceof ImageBitmap) {
            this.cache.close();
        }
        this.cache = null;
        this.currentUrl = null;
        this.pendingPromise = null;
    }
}

export const OverlayCache = new OverlayCacheSystem();

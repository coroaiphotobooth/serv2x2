
import { GalleryItem, PhotoboothSettings, Concept, EventRecord } from '../types';
import { DEFAULT_GAS_URL } from '../constants';

const getGasUrl = () => {
  const url = localStorage.getItem('APPS_SCRIPT_BASE_URL') || DEFAULT_GAS_URL;
  return url.trim();
};

const robustFetch = async (url: string, options: RequestInit = {}) => {
    try {
        if (options.method === 'POST') {
             if (!options.headers) options.headers = {};
             (options.headers as any)['Content-Type'] = 'text/plain;charset=utf-8';
        }
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(`Server Error: ${res.status}`);
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) return await res.json();
        const text = await res.text();
        try { return JSON.parse(text); } catch (e) { throw new Error("Invalid response from server (Not JSON)"); }
    } catch (e: any) {
        console.error("FETCH FAILED:", e.message);
        throw e;
    }
}

export const fetchSettings = async () => {
  const url = getGasUrl();
  return await robustFetch(`${url}?action=getSettings&t=${Date.now()}`);
};

export const fetchEvents = async (): Promise<EventRecord[]> => {
  const url = getGasUrl();
  try {
    const data = await robustFetch(`${url}?action=getEvents&t=${Date.now()}`);
    return data.events || [];
  } catch (error) { return []; }
};

export const fetchImageBase64 = async (fileId: string): Promise<string | null> => {
  const url = getGasUrl();
  try {
    const data = await robustFetch(`${url}?action=getBase64&id=${fileId}`);
    return data.ok ? data.base64 : null;
  } catch (error) { return null; }
};

export const createSessionFolder = async (): Promise<{ok: boolean, folderId?: string, folderUrl?: string}> => {
  const url = getGasUrl();
  try {
    return await robustFetch(url, {
      method: 'POST',
      body: JSON.stringify({ action: 'createSession' })
    });
  } catch (e) { return { ok: false }; }
};

// UPDATED: Accepts optional settings object to ensure correct model/resolution are sent
export const queueVideoTask = async (photoId: string, options?: { prompt?: string, resolution?: string, model?: string }): Promise<{ok: boolean}> => {
  const url = getGasUrl();
  try {
    // Priority: Arguments -> LocalStorage -> Default
    let prompt = options?.prompt;
    let resolution = options?.resolution;
    let model = options?.model;

    if (!prompt || !resolution || !model) {
        const stored = localStorage.getItem('pb_settings');
        const settings = stored ? JSON.parse(stored) : {};
        if (!prompt) prompt = settings.videoPrompt;
        if (!resolution) resolution = settings.videoResolution || '480p';
        if (!model) model = settings.videoModel || 'seedance-1-0-pro-fast-251015';
    }

    return await robustFetch(url, {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'queueVideo', 
        photoId,
        prompt,
        resolution,
        model
      })
    });
  } catch (e) { 
      console.error("Queue Video Failed:", e);
      return { ok: false }; 
  }
};

export const updateVideoStatusInGas = async (photoId: string, status: string, taskId?: string, providerUrl?: string): Promise<{ok: boolean}> => {
  const url = getGasUrl();
  try {
    return await robustFetch(url, {
      method: 'POST',
      body: JSON.stringify({ action: 'updateVideoStatus', photoId, status, taskId, providerUrl })
    });
  } catch (e) { return { ok: false }; }
};

export const uploadToDrive = async (base64Image: string, metadata: any) => {
  const url = getGasUrl();
  try {
    return await robustFetch(url, {
      method: 'POST',
      body: JSON.stringify({ action: 'uploadGenerated', image: base64Image, ...metadata })
    });
  } catch (error: any) { return { ok: false, error: error.message || "FETCH_FAILED" }; }
};

export const uploadVideoToDrive = async (videoBlob: Blob, metadata: any) => {
  const url = getGasUrl();
  const reader = new FileReader();
  return new Promise<any>((resolve) => {
    reader.onloadend = async () => {
      const base64Video = reader.result as string;
      try {
        const res = await robustFetch(url, {
          method: 'POST',
          body: JSON.stringify({ action: 'uploadGeneratedVideo', image: base64Video, mimeType: 'video/mp4', ...metadata })
        });
        resolve(res);
      } catch (e) { resolve({ ok: false, error: "Video Upload Failed" }); }
    };
    reader.readAsDataURL(videoBlob);
  });
};

export const fetchGallery = async (eventId?: string, since?: number): Promise<{ items: GalleryItem[], nextCursor: number, isDelta?: boolean }> => {
  const url = getGasUrl();
  let query = `?action=gallery&t=${Date.now()}`;
  if (eventId) query += `&eventId=${eventId}`;
  if (since && since > 0) query += `&since=${since}`;
  const data = await robustFetch(`${url}${query}`);
  if (Array.isArray(data.items)) {
      return { items: data.items, nextCursor: data.nextCursor || 0, isDelta: data.isDelta };
  }
  return { items: [], nextCursor: 0 };
};

export const deletePhotoFromGas = async (id: string, pin: string) => {
    const url = getGasUrl();
    return await robustFetch(url, { method: 'POST', body: JSON.stringify({ action: 'deletePhoto', pin, id }) });
};

export const deleteAllPhotosFromGas = async (pin: string) => {
    const url = getGasUrl();
    return await robustFetch(url, { method: 'POST', body: JSON.stringify({ action: 'deleteAllPhotos', pin }) });
};

export const saveSettingsToGas = async (settings: PhotoboothSettings, pin: string) => {
    const url = getGasUrl();
    try {
        const data = await robustFetch(url, { method: 'POST', body: JSON.stringify({ action: 'updateSettings', pin, settings }) });
        return data.ok;
    } catch (e) { return false; }
};

export const saveConceptsToGas = async (concepts: Concept[], pin: string) => {
    const url = getGasUrl();
    try {
        const data = await robustFetch(url, { method: 'POST', body: JSON.stringify({ action: 'updateConcepts', pin, concepts }) });
        return data.ok;
    } catch (e) { return false; }
};

export const uploadOverlayToGas = async (base64Image: string, pin: string) => {
    const url = getGasUrl();
    try {
        return await robustFetch(url, { method: 'POST', body: JSON.stringify({ action: 'uploadOverlay', pin, image: base64Image }) });
    } catch (e) { return { ok: false }; }
};

export const uploadBackgroundToGas = async (base64Image: string, pin: string) => {
    const url = getGasUrl();
    try {
        return await robustFetch(url, { method: 'POST', body: JSON.stringify({ action: 'uploadBackground', pin, image: base64Image }) });
    } catch (e) { return { ok: false }; }
};

export const uploadAudioToGas = async (base64Audio: string, pin: string) => {
    const url = getGasUrl();
    try {
        return await robustFetch(url, { method: 'POST', body: JSON.stringify({ action: 'uploadAudio', pin, image: base64Audio }) });
    } catch (e) { return { ok: false }; }
};

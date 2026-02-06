
/**
 * BytePlus (ARK) API Helper
 * Menangani komunikasi ke endpoint Generative (Image & Video).
 */

const ARK_BASE_URL = process.env.ARK_BASE_URL?.replace(/\/$/, '') || 'https://ark.ap-southeast.bytepluses.com/api/v3';
const ARK_API_KEY = process.env.ARK_API_KEY;

if (!ARK_API_KEY) {
  console.warn("WARNING: ARK_API_KEY is not set.");
}

const COMMON_HEADERS = {
  'Authorization': `Bearer ${ARK_API_KEY}`,
  'Content-Type': 'application/json'
};

/**
 * Normalizes image input to ensure it is either a valid URL or a Data URI.
 * Handles bare base64 strings by adding standard png prefix.
 */
function normalizeImageInput(input: string, index: number): string {
    if (!input) throw new Error(`Image input at index ${index} is empty.`);
    
    const trimmed = input.trim();
    const len = trimmed.length;
    const preview = trimmed.substring(0, 40).replace(/\n/g, '');

    // 1. Check for HTTP/HTTPS URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        console.log(`[ARK Seedream] Image ${index}: URL detected (${preview}...)`);
        return trimmed;
    }

    // 2. Check for Data URI (Standard)
    if (trimmed.startsWith('data:image/')) {
        console.log(`[ARK Seedream] Image ${index}: Data URI detected (${preview}... Len: ${len})`);
        return trimmed;
    }

    // 3. Check for Bare Base64 (Heuristic)
    if (len > 100 && !trimmed.includes(' ')) {
        console.log(`[ARK Seedream] Image ${index}: Bare Base64 detected, wrapping... (${preview}... Len: ${len})`);
        return `data:image/png;base64,${trimmed}`;
    }

    throw new Error(`Invalid image input at index ${index}. Must be http(s) URL or valid data:image/... URI.`);
}

/**
 * Generate Image menggunakan Seedream
 */
export async function generateArkImage(payload: {
  model: string;
  prompt: string;
  image_urls?: string[]; 
}) {
  const endpoint = `${ARK_BASE_URL}/images/generations`;
  
  let normalizedImages: string[] | undefined = undefined;
  if (payload.image_urls && payload.image_urls.length > 0) {
      try {
        normalizedImages = payload.image_urls.map((img, i) => normalizeImageInput(img, i));
      } catch (e: any) {
        console.error("[ARK Seedream] Input Validation Error:", e.message);
        throw e;
      }
  }

  const body = {
    model: payload.model,
    prompt: payload.prompt,
    image: normalizedImages,
    response_format: "url",
    size: "2K", 
    stream: false,
    watermark: true,
    sequential_image_generation: "disabled"
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ARK Seedream] Error ${res.status}:`, errText.substring(0, 500));
      throw new Error(`Upstream Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let resultUrl = null;

    if (data.data?.image_urls && Array.isArray(data.data.image_urls) && data.data.image_urls.length > 0) {
        resultUrl = data.data.image_urls[0];
    }
    else if (Array.isArray(data.data) && data.data[0]?.url) {
        resultUrl = data.data[0].url;
    }
    else if (Array.isArray(data.data) && data.data[0]?.image_url) {
        resultUrl = data.data[0].image_url;
    }
    else if (data.data?.url) {
        resultUrl = data.data.url;
    }
    else if (data.image_url) {
        resultUrl = data.image_url;
    }

    if (!resultUrl) {
      throw new Error("No image URL found in upstream response.");
    }

    return resultUrl;
  } catch (error: any) {
    console.error("[ARK Seedream] Exception:", error.message);
    throw error;
  }
}

/**
 * Generate Video menggunakan Seedance (Async Task Endpoint)
 */
export async function startArkVideoTask(payload: {
  model: string;
  prompt: string;
  image_url?: string; 
  duration?: number;
  resolution?: string;
}) {
  const endpoint = `${ARK_BASE_URL}/contents/generations/tasks`;
  
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: payload.prompt }
  ];

  if (payload.image_url) {
    content.push({ type: "image_url", image_url: { url: payload.image_url } });
  }

  // PATCH: STRICT RESOLUTION HANDLING
  // Removed legacy auto-mapping of 480p -> 540p.
  // We now strictly respect '480p' and '720p'.
  
  const allowedResolutions = ['480p', '720p'];
  const requestedRes = payload.resolution || '480p';

  if (!allowedResolutions.includes(requestedRes)) {
      throw new Error(`Invalid resolution: ${requestedRes}. Allowed: 480p, 720p.`);
  }

  console.log(`[ARK Video] Payload Resolution: ${requestedRes}`);

  const body = {
    model: payload.model,
    content: content,
    parameters: {
      duration: payload.duration || 5,
      resolution: requestedRes,
      audio: false
    }
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ARK Video] Error ${res.status}:`, errText);
      throw new Error(`Upstream Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const taskId = data.id || data.Result?.id;

    if (!taskId) {
      throw new Error("No Task ID returned from upstream");
    }

    return taskId;
  } catch (error: any) {
    console.error("[ARK Video] Exception:", error.message);
    throw error;
  }
}


import { assertVideoModel, sanitizeLog } from '../../lib/guards.js';
import { startArkVideoTask } from '../../lib/ark.js';

export const config = {
  maxDuration: 60, // Increased to allow for retries
};

// Helper: Robust Fetch for GAS with Retry
const fetchGasWithRetry = async (url: string, payload: any, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout per attempt

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' }, // Use text/plain for GAS to avoid preflight issues
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            
            clearTimeout(timeout);

            if (res.ok) return await res.json();
            throw new Error(`GAS Status: ${res.status}`);
        } catch (e: any) {
            console.warn(`[API Video] GAS Update Attempt ${i + 1} failed:`, e.message);
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        }
    }
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, imageBase64, driveFileId, sessionFolderId, model, resolution } = req.body;

    // 1. DEFAULT MODEL & GUARD
    const selectedModel = model || process.env.VIDEO_MODEL || 'seedance-1-0-pro-fast-251015';

    // GUARD: Ensure strict Video Model prefix
    try {
      assertVideoModel(selectedModel);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    // PATCH: STRICT RESOLUTION VALIDATION
    let videoResolution = resolution || '480p';
    
    if (videoResolution !== '480p' && videoResolution !== '720p') {
        console.warn(`[API Video] Invalid resolution ${videoResolution}, defaulting to 480p`);
        videoResolution = '480p';
    }

    console.log(`[API Video] Starting task with model: ${selectedModel} | Resolution: ${videoResolution}`);

    // 2. RESOLVE INPUT IMAGE
    let inputImageUrl = "";
    
    if (driveFileId) {
       // PATCH A: Use Thumbnail URL for smaller input size to reduce Seedance output bitrate/size
       const sizeParam = videoResolution === '720p' ? 'w720' : 'w480';
       inputImageUrl = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=${sizeParam}`;
       console.log(`[API Video] drive input = thumbnail sz=${sizeParam}`);
    } else if (imageBase64) {
       inputImageUrl = imageBase64; 
    }

    if (!inputImageUrl) {
        return res.status(400).json({ error: "No input image provided (driveFileId required)" });
    }

    // PATCH B: FORCE RESOLUTION IN PROMPT
    const duration = 5;
    const basePrompt = prompt || "Cinematic movement";
    const forcedPrompt = `${basePrompt} --rs ${videoResolution} --dur ${duration}`;

    // 3. START TASK
    // Passed resolution directly (no mapping)
    const taskId = await startArkVideoTask({
        model: selectedModel,
        prompt: forcedPrompt, // Use modified prompt
        image_url: inputImageUrl,
        resolution: videoResolution,
        duration: duration
    });

    console.log(`[API Video] Task Started: ${taskId}`);

    // 4. REGISTER TO GOOGLE SHEET (QUEUE) - WITH AWAIT & RETRY
    // Critical: If this fails, the frontend won't track the video properly.
    const gasUrl = process.env.APPS_SCRIPT_BASE_URL;
    if (gasUrl && driveFileId) {
        try {
            await fetchGasWithRetry(gasUrl, {
                action: 'updateVideoStatus',
                photoId: driveFileId,
                status: 'processing',
                taskId: taskId,
                videoModel: selectedModel,
                videoResolution: videoResolution // Persist actual resolution
            });
            console.log("[API Video] GAS Updated Successfully");
        } catch (gasError: any) {
            console.error("[API Video] CRITICAL: Failed to update GAS after retries.", gasError);
            // We proceed to return 200 because the video generation actually started.
            // Client might need to rely on polling via task ID if we exposed it, but standard flow relies on GAS.
            // This error will likely result in "Missing log" on UI.
        }
    }

    return res.status(200).json({ 
        ok: true, 
        taskId, 
        status: 'processing',
        message: 'Video generation started',
        resolution: videoResolution
    });

  } catch (error: any) {
    console.error("[API Video] Error:", error.message);
    const status = error.message.includes('Upstream') ? 502 : 500;
    return res.status(status).json({ error: error.message });
  }
}

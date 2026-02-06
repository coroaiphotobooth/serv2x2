
// This endpoint is polled by the App (Global) to process the queue
export const config = {
  maxDuration: 60, 
};

// Helper: Robust Fetch for GAS with Retry
const fetchGasWithRetry = async (url: string, payload: any, retries = 2) => {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); 

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' }, 
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            if (res.ok) return await res.json();
            throw new Error(`Status: ${res.status}`);
        } catch (e: any) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 500));
        }
    }
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const apiKey = process.env.ARK_API_KEY;
  const baseUrl = process.env.ARK_BASE_URL;
  const gasUrl = process.env.APPS_SCRIPT_BASE_URL;
  const defaultModelId = process.env.SEEDANCE_MODEL_ID || 'seedance-1-0-pro-fast-251015';

  if (!apiKey || !baseUrl || !gasUrl) return res.status(500).json({ error: 'Config missing' });

  try {
    const sheetRes = await fetch(`${gasUrl}?action=gallery&t=${Date.now()}`);
    if (!sheetRes.ok) throw new Error(`Failed to fetch Gallery: ${sheetRes.status}`);

    const sheetData = await sheetRes.json();
    const items: any[] = sheetData.items || [];

    const processingTasks = items.filter(i => i.videoStatus === 'processing');
    const queuedTasks = items.filter(i => i.videoStatus === 'queued');
    const activeCount = processingTasks.length + queuedTasks.length;

    const report = { processed: 0, started: 0, rescued: 0, errors: [] as string[] };

    // 1. CHECK PROCESSING TASKS (Cek status yang sedang berjalan)
    for (const task of processingTasks) {
       if (!task.videoTaskId) continue;
       const statusUrl = `${baseUrl.replace(/\/$/, '')}/contents/generations/tasks/${task.videoTaskId}`;
       const sRes = await fetch(statusUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
       
       if (sRes.ok) {
           const sData = await sRes.json();
           const resultObj = sData.Result || sData.data || sData;
           const status = (resultObj.status || 'processing').toLowerCase();
           
           if (status === 'succeeded' || status === 'success') {
               let videoUrl = resultObj.content?.video_url || resultObj.output?.video_url || resultObj.video_url;
               if (videoUrl) {
                   // [CRITICAL FIX] ATOMIC LOCK with RETRY
                   console.log(`[TICK] Attempting lock for ${task.id}...`);
                   
                   try {
                       const lockJson = await fetchGasWithRetry(gasUrl, { 
                           action: 'updateVideoStatus', 
                           photoId: task.id, 
                           status: 'uploading', // Intermediate Lock State
                           providerUrl: videoUrl,
                           requireStatus: 'processing' // Optimistic Locking Requirement
                       });

                       if (lockJson.ok) {
                           console.log(`[TICK] Lock acquired for ${task.id}. Triggering Finalize.`);
                           
                           // Trigger background upload to Drive
                           // We use fire-and-forget logic here but with retry wrapper if needed, 
                           // though `finalizeVideoUpload` is server-to-server and might be long running.
                           fetch(gasUrl, {
                               method: 'POST',
                               headers: { "Content-Type": "text/plain" }, 
                               body: JSON.stringify({ 
                                   action: 'finalizeVideoUpload', 
                                   photoId: task.id, 
                                   videoUrl: videoUrl, 
                                   sessionFolderId: task.sessionFolderId 
                               })
                           }).catch(e => console.error(`[TICK] Finalize trigger failed for ${task.id}`, e));
                           
                           report.processed++;
                       } else {
                           console.warn(`[TICK] Race condition detected for ${task.id}. Skipping duplicate upload.`);
                       }
                   } catch(lockErr: any) {
                       console.error(`[TICK] Lock failed for ${task.id}:`, lockErr.message);
                   }
               }
           } else if (status === 'failed' || status === 'error') {
               await fetchGasWithRetry(gasUrl, { action: 'updateVideoStatus', photoId: task.id, status: 'failed' }).catch(e => console.error("Fail update error", e));
           }
       }
    }

    // 2. START QUEUED TASKS (Mulai render untuk antrian baru)
    const MAX_CONCURRENT = 3;
    const availableSlots = MAX_CONCURRENT - processingTasks.length;

    if (availableSlots > 0 && queuedTasks.length > 0) {
        for (const task of queuedTasks.slice(0, availableSlots)) {
             // PATCH: NATIVE RESOLUTION HANDLING
             let finalRes = task.videoResolution || '480p'; 
             if (finalRes !== '720p' && finalRes !== '480p') finalRes = '480p';
             
             // PATCH A: Use Thumbnail URL for smaller input
             const sizeParam = finalRes === '720p' ? 'w720' : 'w480';
             const driveInputUrl = `https://drive.google.com/thumbnail?id=${task.id}&sz=${sizeParam}`;
             console.log(`[TICK] Starting task ${task.id} with Drive input sz=${sizeParam}`);

             // PATCH B: FORCE PROMPT FLAGS
             const duration = 5;
             const basePrompt = task.videoPrompt || "Cinematic movement";
             const forcedPrompt = `${basePrompt} --rs ${finalRes} --dur ${duration}`;

             const payload = {
                model: task.videoModel || defaultModelId,
                content: [
                    { type: "text", text: forcedPrompt },
                    { type: "image_url", image_url: { url: driveInputUrl } }
                ],
                parameters: { duration: duration, resolution: finalRes, audio: false }
             };

             const startRes = await fetch(`${baseUrl.replace(/\/$/, '')}/contents/generations/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify(payload)
             });
             
             if (startRes.ok) {
                 const startData = await startRes.json();
                 const taskId = startData.id || startData.Result?.id;
                 if (taskId) {
                     try {
                         await fetchGasWithRetry(gasUrl, { 
                             action: 'updateVideoStatus', 
                             photoId: task.id, 
                             status: 'processing', 
                             taskId: taskId 
                         });
                         report.started++;
                     } catch(e) {
                         console.error(`[TICK] Failed to update start status for ${task.id}`, e);
                     }
                 }
             }
        }
    }

    return res.status(200).json({ ok: true, report, activeCount });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

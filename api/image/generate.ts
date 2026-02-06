
import { assertImageModel, isValidImageModel, sanitizeLog } from '../../lib/guards.js';
import { generateArkImage } from '../../lib/ark.js';
import { Buffer } from 'node:buffer';
import OpenAI, { toFile } from 'openai';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, imageBase64, refImageBase64, model, maskBase64, size } = req.body;
    
    // 1. DEFAULT MODEL & GUARD
    const selectedModel = model || process.env.IMAGE_MODEL || 'seedream-4-5-251128';
    
    // GUARD: Ensure strict Image Model prefix
    try {
      assertImageModel(selectedModel);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    console.log(`[API Image] Processing with model: ${selectedModel}`);

    // 2. ROUTING LOGIC

    // A. SEEDREAM (BYTEPLUS)
    if (selectedModel.startsWith('seedream-')) {
        const imageUrls = [];
        if (imageBase64) imageUrls.push(imageBase64);
        if (refImageBase64) imageUrls.push(refImageBase64);

        const resultUrl = await generateArkImage({
            model: selectedModel,
            prompt: prompt,
            image_urls: imageUrls
        });

        // Download & Convert to Base64 for Client consistency
        const imgRes = await fetch(resultUrl);
        const imgBuffer = await imgRes.arrayBuffer();
        const base64Output = Buffer.from(imgBuffer).toString('base64');
        
        return res.status(200).json({ 
            imageBase64: `data:image/png;base64,${base64Output}`,
            provider: 'seedream'
        });
    }

    // B. OPENAI (GPT-IMAGE)
    if (selectedModel.startsWith('gpt-')) {
        // Logic dipindahkan dari api/generate-image-openai.ts
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY missing");
        
        const openai = new OpenAI({ apiKey });
        const toBuffer = (b64: string) => Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64');
        
        const imageBuffer = toBuffer(imageBase64);
        const maskBuffer = maskBase64 ? toBuffer(maskBase64) : undefined;
        let openaiSize: "512x512" | "1024x1024" = "512x512";
        if (size === 1024 || size === '1024') openaiSize = "1024x1024";

        const response = await openai.images.edit({
            model: 'dall-e-2', // Or 'dall-e-3' if supported for edits, standard is dall-e-2 for edits
            image: await toFile(imageBuffer, 'image.png', { type: 'image/png' }),
            mask: maskBuffer ? await toFile(maskBuffer, 'mask.png', { type: 'image/png' }) : undefined,
            prompt: prompt,
            n: 1,
            size: openaiSize,
            response_format: 'b64_json' // Explicitly request b64_json
        });

        // SAFE ACCESS CHECK
        if (!response.data || !response.data[0]) {
             throw new Error("OpenAI No Data Returned");
        }

        const outputBase64 = response.data[0].b64_json;
        if (!outputBase64) throw new Error("OpenAI No Data (Base64 empty)");

        return res.status(200).json({ 
            imageBase64: `data:image/png;base64,${outputBase64}`,
            provider: 'openai'
        });
    }

    // Fallback (Should not reach here due to guard)
    return res.status(400).json({ error: "Unsupported image model" });

  } catch (error: any) {
    console.error("[API Image] Error:", error.message);
    // Normalize upstream errors (502) vs bad request (400)
    const status = error.message.includes('Upstream') ? 502 : 500;
    return res.status(status).json({ error: error.message });
  }
}

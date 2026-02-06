
import PQueue from 'p-queue';

/**
 * GLOBAL AI PROCESSING QUEUE
 * Optimized for Android 13 (8GB RAM) stability.
 * 
 * Rules:
 * 1. Concurrency: Max 2 parallel jobs (prevent overheating/OOM).
 * 2. Rate Limit: Max 8 jobs per minute (prevent API rate limits).
 * 3. Carryover: Ensures smooth distribution.
 */
export const aiQueue = new PQueue({
  concurrency: 2,
  interval: 60000, // 1 Minute Window
  intervalCap: 8,  // Max 8 jobs per window
  carryoverConcurrencyCount: true
});

// Logging for Debugging/Monitoring during Events
aiQueue.on('active', () => {
  console.log(`[Queue Status] Processing: ${aiQueue.pending} | Waiting: ${aiQueue.size}`);
});

aiQueue.on('next', () => {
  console.log(`[Queue Status] Job Completed. Remaining: ${aiQueue.size}`);
});

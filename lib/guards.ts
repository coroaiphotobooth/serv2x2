
/**
 * Model Route Guards
 * Memastikan pemisahan ketat antara model Image dan Video.
 */

export const IMAGE_PREFIX = 'seedream-';
export const VIDEO_PREFIX = 'seedance-';
export const OPENAI_PREFIX = 'gpt-';

export function isValidImageModel(model: string): boolean {
  return model.startsWith(IMAGE_PREFIX) || model.startsWith(OPENAI_PREFIX);
}

export function isValidVideoModel(model: string): boolean {
  return model.startsWith(VIDEO_PREFIX);
}

export function assertImageModel(model: string) {
  if (!isValidImageModel(model)) {
    throw new Error(`Invalid Image Model: ${model}. Must start with '${IMAGE_PREFIX}' or '${OPENAI_PREFIX}'.`);
  }
}

export function assertVideoModel(model: string) {
  if (!isValidVideoModel(model)) {
    throw new Error(`Invalid Video Model: ${model}. Must start with '${VIDEO_PREFIX}'.`);
  }
}

export function sanitizeLog(text: string, maxLength = 50): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...[truncated]";
}

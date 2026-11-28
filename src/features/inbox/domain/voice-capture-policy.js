export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Decide whether another MediaRecorder chunk can be retained without allowing
 * the in-memory recording to exceed the private upload limit.
 */
export function canAppendAudioChunk(currentBytes, nextChunkBytes) {
  if (!Number.isSafeInteger(currentBytes) || currentBytes < 0) return false;
  if (!Number.isSafeInteger(nextChunkBytes) || nextChunkBytes <= 0) return false;
  return nextChunkBytes <= MAX_AUDIO_BYTES
    && currentBytes <= MAX_AUDIO_BYTES - nextChunkBytes;
}

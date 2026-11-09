/** Local compressed files are capped before reading or decoding. */
export const MAX_AUDIO_FILE_BYTES = 40 * 1024 * 1024;
/** Decoded recordings longer than ten minutes are rejected. */
export const MAX_AUDIO_DURATION_SECONDS = 600;
/** Additional decoded PCM guard; browsers allocate PCM before it can be checked. */
export const MAX_DECODED_AUDIO_BYTES = 256 * 1024 * 1024;
export const ANALYSIS_FRAMES_PER_SECOND = 20;
export const MAX_ANALYSIS_FRAMES = MAX_AUDIO_DURATION_SECONDS * ANALYSIS_FRAMES_PER_SECOND + 1;

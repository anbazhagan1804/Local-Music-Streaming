import path from "node:path";

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".wav",
  ".opus"
]);

export function isSupportedAudioExtension(filename: string): boolean {
  return SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

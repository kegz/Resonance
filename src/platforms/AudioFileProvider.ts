import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 160 * 1024 * 1024;
const MAX_FILES = 20;

function validateSelection(files: ReadonlyArray<{ size: number }>): void {
  if (files.length > MAX_FILES) throw new Error('Select no more than 20 audio files at once.');
  if (files.some((file) => file.size > MAX_FILE_BYTES)) {
    throw new Error('Each audio file must be 40 MiB or smaller.');
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
    throw new Error('The selected audio files must total 160 MiB or less.');
  }
}

interface NativeAudioFile {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
}

interface AudioFilesPlugin {
  pickAudioFiles(): Promise<{ files: NativeAudioFile[] }>;
  release(options: { id: string }): Promise<void>;
  requestAudioFocus(): Promise<{ granted: boolean }>;
  abandonAudioFocus(): Promise<void>;
  addListener(event: 'interruption', listener: () => void): Promise<PluginListenerHandle>;
}

const AudioFiles = registerPlugin<AudioFilesPlugin>('AudioFiles');

/** Import copies only: document-provider URIs and persistent permissions never reach JS. */
export async function pickAudioFiles(): Promise<File[]> {
  if (!Capacitor.isNativePlatform()) return pickBrowserFiles();
  const { files } = await AudioFiles.pickAudioFiles();
  try {
    validateSelection(files);
    const result: File[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) throw new Error('Each audio file must be 40 MiB or smaller.');
      const response = await fetch(Capacitor.convertFileSrc(file.path));
      if (!response.ok) throw new Error('Unable to read the imported audio file.');
      const blob = await response.blob();
      if (blob.size > MAX_FILE_BYTES) throw new Error('Each audio file must be 40 MiB or smaller.');
      result.push(new File([blob], file.name, { type: file.type }));
    }
    return result;
  } finally {
    await Promise.all(files.map((file) => AudioFiles.release({ id: file.id })));
  }
}

function pickBrowserFiles(): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac';
    input.multiple = true;
    input.hidden = true;
    const finish = (files: File[]) => {
      input.remove();
      try {
        validateSelection(files);
        resolve(files);
      } catch (error) {
        reject(error);
      }
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    document.body.append(input);
    input.click();
  });
}

/** Interruptions only pause. Regaining focus never resumes playback automatically. */
export async function subscribeToInterruptions(onPause: () => void): Promise<() => void> {
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') onPause();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  const handles: PluginListenerHandle[] = [];
  try {
    if (Capacitor.isNativePlatform()) {
      handles.push(await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) onPause();
      }));
      handles.push(await AudioFiles.addListener('interruption', onPause));
    }
  } catch (error) {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    await Promise.all(handles.map((handle) => handle.remove()));
    throw error;
  }
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    for (const handle of handles) void handle.remove();
  };
}

export async function requestAudioFocus(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  return (await AudioFiles.requestAudioFocus()).granted;
}

export async function abandonAudioFocus(): Promise<void> {
  if (Capacitor.isNativePlatform()) await AudioFiles.abandonAudioFocus();
}

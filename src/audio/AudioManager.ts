import type { SongAnalysis } from '../types';
import { analyzeAudio } from './AudioAnalyzer';
import { MAX_AUDIO_DURATION_SECONDS, MAX_AUDIO_FILE_BYTES, MAX_DECODED_AUDIO_BYTES } from './limits';

export { MAX_AUDIO_DURATION_SECONDS, MAX_AUDIO_FILE_BYTES, MAX_DECODED_AUDIO_BYTES } from './limits';

export class AudioManager {
  onEnded: (() => void) | null = null;
  onInterrupted: (() => void) | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private offset = 0;
  private startedAt = 0;
  private active = false;
  private disposed = false;
  private revision = 0;
  private playbackRevision = 0;
  private volume = 0.8;
  private pending: AbortController | null = null;

  get currentTime(): number {
    return Math.min(this.buffer?.duration ?? 0,
      this.offset + (this.active && this.context ? Math.max(0, this.context.currentTime - this.startedAt) : 0));
  }

  get playing(): boolean {
    return this.active;
  }

  private ensureContext(): AudioContext {
    if (this.disposed) throw new Error('Audio manager has been disposed.');
    if (!this.context) {
      if (typeof globalThis.AudioContext === 'undefined') throw new Error('Web Audio is not supported in this browser.');
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
      this.context.onstatechange = () => {
        if (this.context?.state !== 'running' && this.active) {
          this.pause();
          this.onInterrupted?.();
        }
      };
    }
    return this.context;
  }

  /** Call directly from the file input gesture so context creation/resume is authorized. */
  async load(file: File): Promise<SongAnalysis> {
    const revision = ++this.revision;
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    this.pause();
    this.buffer = null;
    this.offset = 0;
    try {
      if (file.size > MAX_AUDIO_FILE_BYTES) throw new Error('Audio file exceeds the 40 MiB limit.');
      if (!file.size) throw new Error('The audio file is empty.');
      if (!/\.(mp3|wav|m4a|aac)$/i.test(file.name)) {
        throw new Error('Choose a local MP3, WAV, M4A, or AAC file.');
      }
      const context = this.ensureContext();
      // Start resume before the first await: browsers require a user activation.
      if (context.state !== 'running') await context.resume();
      const bytes = await file.arrayBuffer();
      this.assertCurrent(revision);
      if (!globalThis.crypto?.subtle) throw new Error('Secure browser SHA-256 support is required for audio analysis.');
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      this.assertCurrent(revision);
      const fingerprint = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
      let buffer: AudioBuffer;
      try {
        buffer = await context.decodeAudioData(bytes);
      } catch {
        this.assertCurrent(revision);
        throw new Error('Cannot decode this audio file. It may be damaged or its codec unsupported; try MP3 or WAV.');
      }
      this.assertCurrent(revision);
      if (!Number.isFinite(buffer.duration) || buffer.duration > MAX_AUDIO_DURATION_SECONDS) {
        throw new Error('Audio recordings must be no longer than 10 minutes.');
      }
      if (buffer.length * buffer.numberOfChannels * 4 > MAX_DECODED_AUDIO_BYTES) {
        throw new Error('Decoded audio exceeds the 256 MiB memory limit; try a lower sample rate or fewer channels.');
      }
      const analysis = await analyzeAudio(buffer, fingerprint, controller.signal);
      this.assertCurrent(revision);
      this.buffer = buffer;
      return analysis;
    } catch (error) {
      this.assertCurrent(revision);
      throw new Error(error instanceof Error ? error.message : 'Unable to load audio.');
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }

  private assertCurrent(revision: number): void {
    if (this.disposed || revision !== this.revision) {
      throw new DOMException('Audio load was replaced or cancelled.', 'AbortError');
    }
  }

  /** Call from a play button gesture; interrupted contexts are explicitly resumed. */
  async play(): Promise<void> {
    const context = this.ensureContext();
    if (!this.buffer) throw new Error('Load an audio file before playing.');
    if (this.active) return;
    const revision = ++this.playbackRevision;
    if (context.state !== 'running') await context.resume();
    if (revision !== this.playbackRevision || this.disposed || !this.buffer) return;
    if (context.state !== 'running') throw new Error('Audio is interrupted. Tap play to resume.');
    if (this.offset >= this.buffer.duration) this.offset = 0;
    this.startSource(context);
  }

  private startSource(context: AudioContext): void {
    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain!);
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect();
      this.source = null;
      this.offset = this.buffer?.duration ?? 0;
      this.active = false;
      this.onEnded?.();
    };
    this.source = source;
    this.startedAt = context.currentTime;
    try {
      source.start(0, this.offset);
      this.active = true;
    } catch (error) {
      source.onended = null;
      source.disconnect();
      this.source = null;
      throw error;
    }
  }

  pause(): void {
    ++this.playbackRevision;
    this.offset = this.currentTime;
    this.active = false;
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
  }

  seek(seconds: number): void {
    const resume = this.active;
    this.pause();
    this.offset = Number.isNaN(seconds) ? 0 : Math.max(0, Math.min(this.buffer?.duration ?? 0, seconds));
    if (resume && this.context?.state === 'running' && this.buffer && this.offset < this.buffer.duration) {
      this.startSource(this.context);
    }
  }

  setVolume(value: number): void {
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    if (this.gain) this.gain.gain.value = this.volume;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.revision;
    this.pending?.abort();
    this.pending = null;
    this.pause();
    this.buffer = null;
    this.offset = 0;
    this.gain?.disconnect();
    this.gain = null;
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
    this.onEnded = null;
    this.onInterrupted = null;
  }
}

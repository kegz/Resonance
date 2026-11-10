import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeAudio } from '../../src/audio/AudioAnalyzer';
import { AudioFeatureTimeline, featuresAt } from '../../src/audio/AudioFeatureTimeline';
import { AudioManager, MAX_AUDIO_DURATION_SECONDS, MAX_AUDIO_FILE_BYTES } from '../../src/audio/AudioManager';
import type { SongAnalysis } from '../../src/types';

function audioBuffer(duration = 1, sampleRate = 8000, channels = 1, sample = (_time: number, _channel: number) => 0): AudioBuffer {
  const data = Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length: Math.floor(duration * sampleRate) }, (_, index) => sample(index / sampleRate, channel)));
  return {
    duration, sampleRate, numberOfChannels: channels, length: data[0].length,
    getChannelData: (channel: number) => data[channel],
  } as AudioBuffer;
}

describe('offline audio analysis', () => {
  it('handles silence with finite bounded features and a deterministic fallback tempo', async () => {
    const analysis = await analyzeAudio(audioBuffer(), 'silence');
    expect(analysis.fingerprint).toBe('silence');
    expect(analysis.frames).toHaveLength(20);
    expect(analysis.profile).toEqual({ bpm: 120, rms: 0, bass: 0, mids: 0, treble: 0, spectralCentroid: 0 });
    expect(analysis.frames.every((frame) => !frame.beat)).toBe(true);
  });

  it('extracts normalized Meyda band energies and averages every input channel', async () => {
    const sample = (time: number, channel: number) => channel === 2 ? Math.sin(2 * Math.PI * 100 * time) : 0;
    const analysis = await analyzeAudio(audioBuffer(1, 8000, 3, sample), 'tone');
    expect(analysis.profile.rms).toBeGreaterThan(0.1);
    expect(analysis.profile.bass).toBeGreaterThan(0.95);
    for (const frame of analysis.frames) {
      for (const feature of ['rms', 'bass', 'mids', 'treble', 'spectralCentroid'] as const) {
        expect(frame[feature]).toBeGreaterThanOrEqual(0);
        expect(frame[feature]).toBeLessThanOrEqual(1);
      }
      expect(frame.bass + frame.mids + frame.treble).toBeCloseTo(1);
    }
    const cancelled = await analyzeAudio(audioBuffer(1, 8000, 2,
      (time, channel) => Math.sin(2 * Math.PI * 100 * time) * (channel ? -1 : 1)), 'cancelled');
    expect(cancelled.profile.rms).toBe(0);
  });

  it('detects periodic onsets and estimates the beat rate', async () => {
    const analysis = await analyzeAudio(audioBuffer(6, 8000, 1, (time) =>
      time % 0.5 < 0.05 ? Math.sin(2 * Math.PI * 120 * time) * 0.8 : 0), 'pulse');
    expect(analysis.profile.bpm).toBe(120);
    expect(analysis.frames.filter((frame) => frame.beat).length).toBeGreaterThanOrEqual(10);
    expect(analysis.frames.every((frame) => frame.bpm === 120)).toBe(true);
  });

  it('recognizes a non-default tempo at a standard decoded sample rate', async () => {
    const analysis = await analyzeAudio(audioBuffer(5, 44100, 1, (time) =>
      time % 0.6 < 0.04 ? Math.sin(2 * Math.PI * 120 * time) * 0.8 : 0), '100-bpm');
    expect(analysis.profile.bpm).toBe(100);
  });

  it('rejects invalid/overlong buffers and supports cancellation', async () => {
    await expect(analyzeAudio({ duration: MAX_AUDIO_DURATION_SECONDS + 1 } as AudioBuffer, 'long')).rejects.toThrow('600');
    await expect(analyzeAudio(audioBuffer(0), 'empty')).rejects.toThrow('valid samples');
    const controller = new AbortController();
    controller.abort();
    await expect(analyzeAudio(audioBuffer(), 'abort', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('yields during longer analysis instead of monopolizing the event loop', async () => {
    let yielded = false;
    const timer = setTimeout(() => { yielded = true; }, 0);
    await analyzeAudio(audioBuffer(2), 'yield');
    clearTimeout(timer);
    expect(yielded).toBe(true);
  });
});

describe('feature timeline', () => {
  const profile = { bpm: 120, rms: 0.2, bass: 0.4, mids: 0.4, treble: 0.2, spectralCentroid: 0.3 };
  const analysis: SongAnalysis = {
    fingerprint: 'test', duration: 0.15, profile,
    frames: [
      { ...profile, time: 0, beat: true },
      { ...profile, time: 0.05, beat: false, rms: 0.5 },
      { ...profile, time: 0.1, beat: true, rms: 0.8 },
    ],
  };

  it('clamps boundaries and samples deterministic beat intervals', () => {
    expect(featuresAt(analysis, -5)).toEqual({ ...analysis.frames[0], time: 0 });
    expect(featuresAt(analysis, NaN).time).toBe(0);
    expect(featuresAt(analysis, 0.049).beat).toBe(true);
    expect(featuresAt(analysis, 0.05).beat).toBe(false);
    expect(featuresAt(analysis, 0.1).beat).toBe(true);
    expect(featuresAt(analysis, Infinity)).toEqual({ ...analysis.frames[2], time: 0.15, beat: false });
    const timeline = new AudioFeatureTimeline(analysis);
    expect(timeline.featuresAt(0.07)).toEqual(featuresAt(analysis, 0.07));
    expect(AudioFeatureTimeline.featuresAt(analysis, 0.07)).toEqual(featuresAt(analysis, 0.07));
    const frame = timeline.featuresAt(0);
    frame.rms = 1;
    expect(analysis.frames[0].rms).toBe(0.2);
  });

  it('provides silent beat flags for empty timelines', () => {
    expect(featuresAt({ ...analysis, frames: [] }, 10)).toEqual({ ...profile, time: 0.15, beat: false });
  });
});

class MockSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockContext {
  static instances: MockContext[] = [];
  state = 'suspended';
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  sources: MockSource[] = [];
  gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  decodeAudioData = vi.fn(async (_bytes: ArrayBuffer) => audioBuffer());
  createGain = vi.fn(() => this.gain);
  createBufferSource = vi.fn(() => {
    const source = new MockSource();
    this.sources.push(source);
    return source;
  });

  constructor() {
    MockContext.instances.push(this);
  }
}

function file(name = 'track.mp3', content = [1, 2, 3]): File {
  return { name, size: content.length, arrayBuffer: async () => new Uint8Array(content).buffer } as File;
}

function setup(): { manager: AudioManager; context: () => MockContext } {
  MockContext.instances = [];
  vi.stubGlobal('AudioContext', MockContext);
  const manager = new AudioManager();
  return { manager, context: () => MockContext.instances[0] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local audio manager', () => {
  it('hashes bytes rather than file metadata and resumes synchronously in the gesture', async () => {
    const { manager, context } = setup();
    const loading = manager.load(file());
    expect(context().resume).toHaveBeenCalledOnce();
    const first = await loading;
    const renamed = await manager.load(file('other.wav'));
    const changed = await manager.load(file('track.mp3', [3, 2, 1]));
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(renamed.fingerprint).toBe(first.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(MockContext.instances).toHaveLength(1);
    manager.dispose();
  });

  it('pauses, recreates sources on seek, clamps position and cleans up on end', async () => {
    const { manager, context } = setup();
    await manager.load(file());
    await manager.play();
    expect(manager.playing).toBe(true);
    context().currentTime = 0.25;
    expect(manager.currentTime).toBe(0.25);
    manager.pause();
    expect(manager.playing).toBe(false);
    expect(context().sources[0].stop).toHaveBeenCalledOnce();
    expect(context().sources[0].disconnect).toHaveBeenCalledOnce();
    context().currentTime = 3;
    expect(manager.currentTime).toBe(0.25);
    await manager.play();
    expect(context().sources[1].start).toHaveBeenCalledWith(0, 0.25);
    manager.seek(0.6);
    expect(context().sources[1].stop).toHaveBeenCalledOnce();
    expect(context().sources[2].start).toHaveBeenCalledWith(0, 0.6);
    const ended = vi.fn();
    manager.onEnded = ended;
    context().sources[2].onended?.();
    expect(manager.currentTime).toBe(1);
    expect(manager.playing).toBe(false);
    expect(ended).toHaveBeenCalledOnce();
    expect(context().sources[2].disconnect).toHaveBeenCalledOnce();
    await manager.play();
    expect(context().sources[3].start).toHaveBeenCalledWith(0, 0);
    manager.seek(Infinity);
    expect(manager.currentTime).toBe(1);
    expect(manager.playing).toBe(false);
    manager.seek(-1);
    expect(manager.currentTime).toBe(0);
    manager.setVolume(2);
    expect(context().gain.gain.value).toBe(1);
    manager.setVolume(-1);
    expect(context().gain.gain.value).toBe(0);
    manager.dispose();
    manager.dispose();
    expect(context().close).toHaveBeenCalledOnce();
    expect(context().gain.disconnect).toHaveBeenCalledOnce();
    expect(context().onstatechange).toBeNull();
    await expect(manager.play()).rejects.toThrow('disposed');
  });

  it('pauses a suspended or interrupted session and resumes only on explicit play', async () => {
    const { manager, context } = setup();
    await manager.load(file());
    await manager.play();
    const interrupted = vi.fn();
    manager.onInterrupted = interrupted;
    context().currentTime = 0.4;
    context().state = 'interrupted';
    context().onstatechange?.();
    expect(manager.playing).toBe(false);
    expect(manager.currentTime).toBe(0.4);
    expect(interrupted).toHaveBeenCalledOnce();
    await manager.play();
    expect(context().resume).toHaveBeenCalledTimes(2);
    expect(context().sources[1].start).toHaveBeenCalledWith(0, 0.4);
    manager.dispose();
  });

  it('stops previous audio even when a replacement fails validation or decoding', async () => {
    const { manager, context } = setup();
    await manager.load(file());
    await manager.play();
    await expect(manager.load({ ...file(), size: MAX_AUDIO_FILE_BYTES + 1 } as File)).rejects.toThrow('40 MiB');
    expect(manager.playing).toBe(false);
    expect(context().sources[0].stop).toHaveBeenCalledOnce();
    await expect(manager.play()).rejects.toThrow('Load an audio');
    await expect(manager.load(file('bad.ogg'))).rejects.toThrow('MP3');
    await expect(manager.load(file('empty.mp3', []))).rejects.toThrow('empty');
    context().decodeAudioData.mockRejectedValueOnce(new Error('decoder error'));
    await expect(manager.load(file())).rejects.toThrow('Cannot decode');
    expect(manager.currentTime).toBe(0);
    manager.dispose();
  });

  it('rejects oversized decoded recordings before analysis', async () => {
    const { manager, context } = setup();
    await manager.load(file());
    context().decodeAudioData.mockResolvedValueOnce({ duration: 601 } as AudioBuffer);
    await expect(manager.load(file())).rejects.toThrow('10 minutes');
    expect(manager.playing).toBe(false);
    manager.dispose();
  });

  it('prevents an older asynchronous load replacing the newest recording', async () => {
    const { manager, context } = setup();
    await manager.load(file());
    let resolve!: (value: ArrayBuffer) => void;
    const delayed = file();
    delayed.arrayBuffer = () => new Promise<ArrayBuffer>((done) => { resolve = done; });
    const older = manager.load(delayed);
    const rejected = expect(older).rejects.toMatchObject({ name: 'AbortError' });
    const latest = await manager.load(file('new.wav', [4, 5, 6]));
    resolve(new Uint8Array([0]).buffer);
    await rejected;
    await manager.play();
    expect(context().sources[0].buffer?.duration).toBe(latest.duration);
    manager.dispose();
  });

  it('does not resurrect playback after pause while resume is pending', async () => {
    const { manager, context } = setup();
    await manager.load(file());
    context().state = 'suspended';
    let resolve!: () => void;
    context().resume.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const playing = manager.play();
    manager.pause();
    context().state = 'running';
    resolve();
    await playing;
    expect(manager.playing).toBe(false);
    expect(context().sources).toHaveLength(0);
    manager.dispose();
  });
});

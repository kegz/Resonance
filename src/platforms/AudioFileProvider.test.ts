import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: false,
  pick: vi.fn(),
  release: vi.fn(),
  focus: vi.fn(),
  abandon: vi.fn(),
  nativeListen: vi.fn(),
  appListen: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    convertFileSrc: (path: string) => `https://localhost/_capacitor_file_/${path}`,
  },
  registerPlugin: () => ({
    pickAudioFiles: mocks.pick,
    release: mocks.release,
    requestAudioFocus: mocks.focus,
    abandonAudioFocus: mocks.abandon,
    addListener: mocks.nativeListen,
  }),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.appListen },
}));

import {
  abandonAudioFocus,
  pickAudioFiles,
  requestAudioFocus,
  subscribeToInterruptions,
} from './AudioFileProvider';

class FakeInput extends EventTarget {
  type = '';
  accept = '';
  multiple = false;
  hidden = false;
  files: File[] | null = null;
  remove = vi.fn();
  click = vi.fn();
}

describe('audio platform integration', () => {
  let input: FakeInput;
  let documentMock: EventTarget & { visibilityState: string };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.native = false;
    input = new FakeInput();
    documentMock = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      createElement: vi.fn(() => input),
      body: { append: vi.fn() },
    });
    vi.stubGlobal('document', documentMock);
    mocks.release.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a browser multi-select picker and returns local Files', async () => {
    const pending = pickAudioFiles();
    const file = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });
    input.files = [file];
    input.dispatchEvent(new Event('change'));
    await expect(pending).resolves.toEqual([file]);
    expect(input.accept).toContain('.m4a');
    expect(input.multiple).toBe(true);
    expect(input.remove).toHaveBeenCalledOnce();
    expect(mocks.pick).not.toHaveBeenCalled();
  });

  it('resolves browser cancellation with no files and removes the input', async () => {
    const pending = pickAudioFiles();
    input.dispatchEvent(new Event('cancel'));
    await expect(pending).resolves.toEqual([]);
    expect(input.remove).toHaveBeenCalledOnce();
  });

  it('rejects browser files over the same native 40 MiB bound', async () => {
    const pending = pickAudioFiles();
    const file = new File([], 'huge.wav');
    Object.defineProperty(file, 'size', { value: 40 * 1024 * 1024 + 1 });
    input.files = [file];
    input.dispatchEvent(new Event('change'));
    await expect(pending).rejects.toThrow('40 MiB');
    expect(input.remove).toHaveBeenCalledOnce();
  });

  it.each([
    { count: 21, size: 1, message: '20 audio files' },
    { count: 5, size: 40 * 1024 * 1024, message: '160 MiB' },
  ])('rejects browser batches exceeding selection bounds: $message', async ({ count, size, message }) => {
    const pending = pickAudioFiles();
    input.files = Array.from({ length: count }, (_, index) => {
      const file = new File([], `${index}.wav`);
      Object.defineProperty(file, 'size', { value: size });
      return file;
    });
    input.dispatchEvent(new Event('change'));
    await expect(pending).rejects.toThrow(message);
    expect(input.remove).toHaveBeenCalledOnce();
  });

  it('fetches private native copies without putting audio bytes on the bridge', async () => {
    mocks.native = true;
    mocks.pick.mockResolvedValue({
      files: [{ id: 'one', name: 'song.aac', type: 'audio/aac', size: 3, path: 'file:///cache/one' }],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['abc'])));
    vi.stubGlobal('fetch', fetchMock);
    const files = await pickAudioFiles();
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('song.aac');
    expect(await files[0].text()).toBe('abc');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://localhost/_capacitor_file_/file:///cache/one',
    );
    expect(mocks.release).toHaveBeenCalledWith({ id: 'one' });
  });

  it('releases every native copy even when a transfer fails', async () => {
    mocks.native = true;
    mocks.pick.mockResolvedValue({
      files: ['one', 'two'].map((id) => ({
        id, name: `${id}.wav`, type: 'audio/wav', size: 3, path: `file:///cache/${id}`,
      })),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Read failed')));
    await expect(pickAudioFiles()).rejects.toThrow('Read failed');
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized native metadata before fetching and still releases it', async () => {
    mocks.native = true;
    mocks.pick.mockResolvedValue({
      files: [{
        id: 'large', name: 'song.wav', type: 'audio/wav',
        size: 40 * 1024 * 1024 + 1, path: 'file:///cache/large',
      }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(pickAudioFiles()).rejects.toThrow('40 MiB');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith({ id: 'large' });
  });

  it.each([
    { count: 21, size: 1, message: '20 audio files' },
    { count: 5, size: 40 * 1024 * 1024, message: '160 MiB' },
  ])('rejects native batches before fetching: $message', async ({ count, size, message }) => {
    mocks.native = true;
    mocks.pick.mockResolvedValue({
      files: Array.from({ length: count }, (_, index) => ({
        id: `${index}`, name: `${index}.wav`, type: 'audio/wav',
        size, path: `file:///cache/${index}`,
      })),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(pickAudioFiles()).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(count);
  });

  it('pauses on browser backgrounding but never on foregrounding', async () => {
    const pause = vi.fn();
    const unsubscribe = await subscribeToInterruptions(pause);
    documentMock.visibilityState = 'hidden';
    documentMock.dispatchEvent(new Event('visibilitychange'));
    documentMock.visibilityState = 'visible';
    documentMock.dispatchEvent(new Event('visibilitychange'));
    expect(pause).toHaveBeenCalledOnce();
    unsubscribe();
    documentMock.visibilityState = 'hidden';
    documentMock.dispatchEvent(new Event('visibilitychange'));
    expect(pause).toHaveBeenCalledOnce();
    await expect(requestAudioFocus()).resolves.toBe(true);
    await abandonAudioFocus();
    expect(mocks.focus).not.toHaveBeenCalled();
  });

  it('bridges native focus loss and app backgrounding, disposing both listeners', async () => {
    mocks.native = true;
    const appRemove = vi.fn().mockResolvedValue(undefined);
    const nativeRemove = vi.fn().mockResolvedValue(undefined);
    mocks.appListen.mockResolvedValue({ remove: appRemove });
    mocks.nativeListen.mockResolvedValue({ remove: nativeRemove });
    mocks.focus.mockResolvedValue({ granted: false });
    const pause = vi.fn();
    const unsubscribe = await subscribeToInterruptions(pause);
    const appCallback = mocks.appListen.mock.calls[0][1] as (state: { isActive: boolean }) => void;
    const interruption = mocks.nativeListen.mock.calls[0][1] as () => void;
    appCallback({ isActive: false });
    appCallback({ isActive: true });
    interruption();
    expect(pause).toHaveBeenCalledTimes(2);
    await expect(requestAudioFocus()).resolves.toBe(false);
    await abandonAudioFocus();
    expect(mocks.abandon).toHaveBeenCalledOnce();
    unsubscribe();
    expect(appRemove).toHaveBeenCalledOnce();
    expect(nativeRemove).toHaveBeenCalledOnce();
  });
});

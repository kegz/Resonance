export interface Preferences {
  volume: number;
  intensity: number;
  difficulty: number;
}

export const DEFAULT_PREFERENCES: Preferences = { volume: 0.7, intensity: 0.4, difficulty: 1 };

export class Settings {
  private database: Promise<IDBDatabase>;

  constructor() {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open('resonance', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Private browsing may disable storage. Callers still get defaults.
    void this.database.catch(() => undefined);
  }

  private async read(key: string): Promise<unknown> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const request = database.transaction('settings').objectStore('settings').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async write(key: string, value: unknown): Promise<void> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async preferences(): Promise<Preferences> {
    try {
      const value = await this.read('preferences') as Partial<Preferences> | undefined;
      const finite = (n: unknown, fallback: number, min: number, max: number) =>
        typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
      return {
        volume: finite(value?.volume, DEFAULT_PREFERENCES.volume, 0, 1),
        intensity: finite(value?.intensity, DEFAULT_PREFERENCES.intensity, 0, 1),
        difficulty: finite(value?.difficulty, DEFAULT_PREFERENCES.difficulty, 1, 3),
      };
    } catch { return { ...DEFAULT_PREFERENCES }; }
  }

  savePreferences(value: Preferences) { return this.write('preferences', value); }

  async highScore(fingerprint: string): Promise<number> {
    try {
      const value = await this.read(`score:${fingerprint}`);
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    } catch { return 0; }
  }

  async recordScore(fingerprint: string, score: number): Promise<number> {
    const best = Math.max(await this.highScore(fingerprint), score);
    await this.write(`score:${fingerprint}`, best);
    return best;
  }
}

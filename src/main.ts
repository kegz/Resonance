import Phaser from 'phaser';
import './style.css';
import { AudioManager } from './audio/AudioManager';
import { featuresAt } from './audio/AudioFeatureTimeline';
import { GameLoop } from './core/GameLoop';
import { generateLevel } from './world/LevelGenerator';
import { InputControls } from './input/InputControls';
import { GameScene } from './scenes/GameScene';
import { Settings, DEFAULT_PREFERENCES } from './ui/Settings';
import {
  pickAudioFiles, subscribeToInterruptions, requestAudioFocus, abandonAudioFocus,
} from './platforms/AudioFileProvider';
import type { Level, SongAnalysis } from './types';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header>
    <div><p class="eyebrow">YOUR MUSIC. ANOTHER WORLD.</p><h1>Resonance<span>↶</span></h1></div>
    <button id="import" class="primary">＋ Import music</button>
  </header>
  <main>
    <section class="toolbar" aria-label="Session controls">
      <div class="track"><strong id="track">Choose a song to begin</strong><span id="profile">Local audio · no uploads · offline</span></div>
      <button id="play" disabled>Resume</button>
      <button id="restart" disabled>Restart</button>
      <button id="next" disabled>Next track →</button>
    </section>
    <section id="stage" aria-label="Music-reactive adventure">
      <div id="game" role="img" aria-label="Game world. Collect golden notes, avoid triangular hazards, and interact with the exit."></div>
      <div class="hud"><span id="health">HEALTH —</span><span id="objectives">NOTES —</span><span id="time">0:00</span></div>
      <div id="welcome"><h2>Every song is a new beginning.</h2><p>Collect the notes. Reach the gate.<br>Rewind the last five seconds to try again.</p></div>
      <div class="touch" aria-label="Touch controls">
        <div><button data-control="left" aria-label="Move left">◀</button><button data-control="right" aria-label="Move right">▶</button></div>
        <div><button data-control="rewind" aria-label="Rewind five seconds">↶</button><button data-control="interact" aria-label="Interact">E</button><button data-control="jump" aria-label="Jump">↑</button></div>
      </div>
    </section>
    <p id="status" role="status" aria-live="polite">Import MP3, WAV, or decoder-supported M4A/AAC. Up to 40 MiB and 10 minutes per track.</p>
    <div class="details">
      <section><h2>Make it your own</h2>
        <div class="settings">
          <label>Volume <input id="volume" type="range" min="0" max="1" step="0.05" value="0.7"></label>
          <label>Visual intensity <input id="intensity" type="range" min="0" max="1" step="0.05" value="0.4"></label>
          <label>Difficulty <select id="difficulty"><option value="1">Gentle</option><option value="2">Standard</option><option value="3">Challenging</option></select></label>
        </div><p id="settings-state" class="muted" aria-live="polite">Preferences stay on this device.</p><p class="muted">Intensity zero removes music pulses. System reduced-motion preferences are respected. Difficulty applies to the next level.</p>
      </section>
      <section><h2>Find your rhythm</h2><p class="instructions">A / D or ← / → move · Space jumps · E interacts<br>R rewinds game and music · Esc pauses</p><p id="best" class="muted">Scores are saved only on this device.</p></section>
    </div>
    <section id="playlist-section" hidden><h2>Playlist</h2><ol id="playlist"></ol></section>
  </main>
  <footer>Single-player. Offline-first. Headphones recommended. <span id="offline"></span></footer>
`;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (message: string) => { element('status').textContent = message; };
const audio = new AudioManager();
const settings = new Settings();
const scene = new GameScene();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960, height: 540,
  backgroundColor: '#0b1020',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [scene],
  audio: { noAudio: true },
  render: { antialias: true },
});
let preferences = { ...DEFAULT_PREFERENCES };
let playlist: File[] = [];
let trackIndex = -1;
let analysis: SongAnalysis | undefined;
let level: Level | undefined;
let loop: GameLoop | undefined;
let busy = false;
let rewinding = false;
let scored = false;
let lifecycleGeneration = 0;
let lastAudioTime = 0;
let preferencesRevision = 0;
const input = new InputControls(element('stage'), () => { void togglePlayback(); });

function buttons() {
  element<HTMLButtonElement>('import').disabled = busy;
  element<HTMLButtonElement>('play').disabled = busy || !loop;
  element<HTMLButtonElement>('restart').disabled = busy || !loop;
  element<HTMLButtonElement>('next').disabled = busy || trackIndex + 1 >= playlist.length;
  element('play').textContent = audio.playing ? 'Pause' : 'Resume';
}

function pause() {
  lifecycleGeneration++;
  audio.pause();
  loop?.pause();
  input.reset();
  void abandonAudioFocus().catch(() => undefined);
  buttons();
}

async function play() {
  if (!loop || busy) return;
  const generation = lifecycleGeneration;
  if (!await requestAudioFocus()) {
    status('Audio is in use by another application. Try Resume when it is available.');
    return;
  }
  if (generation !== lifecycleGeneration || document.hidden) {
    await abandonAudioFocus();
    return;
  }
  await audio.play();
  if (generation !== lifecycleGeneration || document.hidden) {
    pause();
    return;
  }
  loop.resume();
  lastAudioTime = audio.currentTime;
  status('Collect every golden note, then press E at the gate. R rewinds five seconds.');
  buttons();
}

async function togglePlayback() {
  try { if (audio.playing) pause(); else await play(); }
  catch (error) { pause(); status(error instanceof Error ? error.message : 'Playback could not start.'); }
}

async function saveScore() {
  if (!loop || !analysis || scored || !loop.state.won) return;
  scored = true;
  const score = Math.max(1, Math.round(1000 * loop.state.player.health + 6000 - loop.state.audioTime * 10));
  try {
    const best = await settings.recordScore(analysis.fingerprint, score);
    element('best').textContent = `Track best: ${best} · This run: ${score}`;
  } catch { element('best').textContent = `This run: ${score} · Device storage unavailable`; }
}

function renderPlaylist() {
  const list = element('playlist');
  list.replaceChildren();
  playlist.forEach((file, index) => {
    const item = document.createElement('li');
    item.textContent = `${index === trackIndex ? '▶ ' : ''}${file.name}`;
    if (index === trackIndex) item.setAttribute('aria-current', 'true');
    list.append(item);
  });
  element('playlist-section').hidden = playlist.length < 2;
}

async function loadTrack(index: number) {
  if (busy || !playlist[index]) return;
  pause();
  const generation = lifecycleGeneration;
  busy = true;
  buttons();
  status('Decoding and analyzing locally…');
  loop = undefined;
  analysis = undefined;
  level = undefined;
  scene.clearWorld();
  try {
    const result = await audio.load(playlist[index]);
    analysis = result;
    level = generateLevel(result.profile, result.fingerprint, Math.round(preferences.difficulty));
    loop = new GameLoop(level);
    trackIndex = index;
    scored = false;
    rewinding = false;
    element('track').textContent = playlist[index].name;
    element('profile').textContent = `${level.environment.theme.toUpperCase()} · ${Math.round(result.profile.bpm)} BPM · ${formatTime(result.duration)}`;
    element('welcome').hidden = true;
    element('best').textContent = `Track best: ${await settings.highScore(result.fingerprint)}`;
    scene.present(level, loop.state, result.profile, preferences.intensity);
    renderPlaylist();
    busy = false;
    // Backgrounding during analysis must never start a new audio session.
    if (!document.hidden && generation === lifecycleGeneration) await play();
    else status('Track ready. Press Resume to play.');
  } catch (error) {
    pause();
    status(error instanceof Error ? error.message : 'This audio file could not be loaded.');
  } finally { busy = false; buttons(); }
}

element('import').addEventListener('click', () => {
  void (async () => {
    if (busy) return;
    pause();
    busy = true;
    buttons();
    try {
      const files = await pickAudioFiles();
      if (files.length) {
        if (files.length > 20 || files.reduce((total, file) => total + file.size, 0) > 160 * 1024 * 1024) {
          throw new Error('Choose at most 20 tracks totaling no more than 160 MiB.');
        }
        playlist = files;
        trackIndex = -1;
        busy = false;
        await loadTrack(0);
      } else status('Selection cancelled. Resume your current track or import another song.');
    } catch (error) { status(error instanceof Error ? error.message : 'File selection failed.'); }
    finally { busy = false; buttons(); }
  })();
});
element('play').addEventListener('click', () => { void togglePlayback(); });
element('next').addEventListener('click', () => { void loadTrack(trackIndex + 1); });
element('restart').addEventListener('click', () => { void loadTrack(trackIndex); });

for (const key of ['volume', 'intensity', 'difficulty'] as const) {
  element<HTMLInputElement>(key).addEventListener('input', (event) => {
    const revision = ++preferencesRevision;
    preferences[key] = Number((event.target as HTMLInputElement).value);
    audio.setVolume(preferences.volume);
    element('settings-state').textContent = 'Saving settings…';
    void settings.savePreferences({ ...preferences }).then(() => {
      if (revision === preferencesRevision) element('settings-state').textContent = 'Settings saved.';
    }).catch(() => {
      if (revision === preferencesRevision) element('settings-state').textContent = 'Settings apply only to this session; device storage is unavailable.';
    });
  });
}
void settings.preferences().then((value) => {
  if (preferencesRevision) return;
  preferences = value;
  for (const key of ['volume', 'intensity', 'difficulty'] as const) element<HTMLInputElement>(key).value = String(value[key]);
  audio.setVolume(value.volume);
});

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

scene.onFrame = () => {
  if (!loop || !analysis || !level || busy) return;
  const controls = input.state;
  if (controls.rewind && !rewinding) {
    const snapshot = loop.rewind(5);
    audio.seek(snapshot.audioTime);
    lastAudioTime = snapshot.audioTime;
    status(`Rewound to ${formatTime(snapshot.audioTime)}. ${audio.playing ? 'Try another path.' : 'Press Resume to continue.'}`);
  }
  rewinding = controls.rewind;
  if (audio.playing) {
    const now = audio.currentTime;
    const elapsed = now - lastAudioTime;
    lastAudioTime = now;
    if (now - loop.state.audioTime > 0.3) {
      pause();
      audio.seek(loop.state.audioTime);
      status('Paused to keep music and gameplay aligned. Press Resume.');
    } else {
      loop.advance(Math.max(0, elapsed), { ...controls, rewind: false }, (time) => featuresAt(analysis!, time));
    }
    if (loop.state.player.health <= 0) {
      pause();
      status('Out of health. Press R to rewind, then Resume, or restart the track.');
    }
    if (loop.state.won && !scored) {
      status('Gate reached! Keep listening, rewind to explore, or choose the next track.');
      void saveScore();
    }
  }
  const state = loop.state;
  scene.present(level, state, featuresAt(analysis, state.audioTime), preferences.intensity);
  element('health').textContent = `HEALTH ${state.player.health}`;
  element('objectives').textContent = `NOTES ${state.collectibles.filter((item) => item.collected).length}/${state.collectibles.length}`;
  element('time').textContent = `${formatTime(state.audioTime)} / ${formatTime(analysis.duration)}`;
};

audio.onEnded = () => {
  pause();
  if (trackIndex + 1 < playlist.length) void loadTrack(trackIndex + 1);
  else status('Playlist complete. Restart this track or import more music.');
};
audio.onInterrupted = () => {
  pause();
  status('Audio interrupted. Press Resume to continue.');
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('blur', () => pause());
void subscribeToInterruptions(() => {
  pause();
  status('Playback paused by an interruption. Press Resume when ready.');
}).catch(() => status('Native lifecycle integration unavailable. Playback remains paused when hidden.'));

// AudioContext can be suspended independently of page visibility.
window.setInterval(() => {
  if (!audio.playing && element('play').textContent === 'Pause') {
    pause();
    status('Audio interrupted. Press Resume to continue.');
  }
}, 500);
window.addEventListener('pagehide', (event) => {
  pause();
  if (!event.persisted) {
    input.dispose();
    audio.dispose();
    game.destroy(true);
  }
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').then(async (registration) => {
    if (registration.active) element('offline').textContent = 'Available offline';
    else {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'activated') element('offline').textContent = 'Available offline';
      });
    }
  }).catch(() => { element('offline').textContent = 'Offline cache unavailable'; });
}

# Resonance

A 2D, single-player music adventure for desktop browsers and Android. Import a
local song, collect its world's golden notes, and reach the gate. Rewind up to
five seconds of both gameplay and music to correct mistakes.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the printed localhost address. Import MP3 or WAV; M4A/AAC works when the
browser/platform decoder supports it. Choose multiple files for a playlist.
Tracks stay on the device: there are no accounts, uploads, analytics, streaming
integrations, or remote runtime assets.

```sh
npm test              # deterministic world, simulation, audio and platform tests
npm run typecheck
npm run build
npx playwright install chromium
PREVIEW=1 npm run test:e2e  # production browser flows, including offline reload
npm run preview
```

The production build installs an offline shell after its first successful load
over HTTPS or localhost. Wait for **Available offline** before disconnecting.
Browser audio selections are session-only: reselect files after a reload.
Android bundles all web assets and needs no first-run network connection.

## Controls and accessibility

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | A/D or left/right arrows | Left/right buttons |
| Jump | Space, W, or up arrow | Up button |
| Interact with gate | E or down arrow | E button |
| Rewind five seconds | R | Rewind button |
| Pause/resume | Esc or toolbar | Toolbar |

Collect every note before interacting with the gate. Triangular hazards are
dangerous while bright and inactive while dim. Losing health pauses the game;
rewind, then Resume, or restart. Rewind is bounded by the track start and the last
five seconds of simulated history, and discards the abandoned future.

Visual intensity, volume, and next-level difficulty are configurable. Intensity
zero disables music pulses, and system reduced-motion preferences disable pulse
animation. Effects avoid full-screen flashes or camera shake. Touch controls
support concurrent movement/jump and pointer cancellation. Portrait browser
layouts remain usable; Android requests landscape. Settings and per-song best
scores use IndexedDB, falling back to session defaults if storage is unavailable.
Wait for **Settings saved** before reloading or closing the page.

## Android

Requires JDK **21**, Android SDK platform **36**, and Android build tools.
The minimum supported OS is Android 10/API **29**.

```sh
npm run android:sync
npm run android:debug
# android/app/build/outputs/apk/debug/app-debug.apk
npx cap open android
```

Configure `ANDROID_HOME` or Android Studio's local SDK path. Gradle's first build
needs access to Google Maven and Maven Central. The checked-in Capacitor project
uses the same TypeScript game, with a small Java bridge for:

- Android's system document picker (Storage Access Framework), with no broad
  storage/media permissions.
- Bounded private-cache copies, deleted after transfer and cleaned on launch.
- Audio-focus loss and background interruptions. Gameplay and audio pause
  together; returning never automatically resumes.

The manifest requests no permissions, disables cleartext traffic, and disables
application backup. Release APK signing is deliberately not configured: use
Android Studio with your own private signing credentials; never commit them.
CI produces web artifacts and an unsigned-for-release, debug-signed APK.

Instrumentation smoke checks can be run with a connected device/emulator after
sync using `cd android && ./gradlew connectedDebugAndroidTest`. Before release,
test actual document-provider imports (including cancellation), phone-call/audio
focus interruptions, rotation, simultaneous touch input, airplane-mode startup,
and seeking on physical Android 10+ devices.

## Design and limits

- **Audio:** Web Audio decoding plus Meyda FFT/RMS and custom onset/tempo
  estimation produce a 20 Hz feature timeline. Bass/mid/treble energy and
  normalized spectral centroid select the palette; energy and detected onsets
  drive restrained visual pulses. Tempo/bass drive predictable hazard phases.
  Silence has a stable fallback tempo; genre is not inferred.
- **Determinism:** SHA-256 of file bytes, difficulty, generator version, and
  world variant seed the generator. Candidates are validated with the actual
  platformer physics, including safe routes to mandatory notes and the exit.
  Invalid candidates retry with derived seeds, with a bounded failure.
- **Simulation:** A fixed 60 Hz simulation samples audio features per tick.
  Deep snapshots at 20 Hz retain five seconds of position, velocity, health,
  collected items, hazard phases, timers, PRNG state, and audio time. Rendering
  never owns gameplay physics.
- **Synchronization:** The Web Audio playback clock drives simulation. Seeks
  recreate one audio source; pauses never advance simulation. If rendering falls
  more than 300 ms behind, playback pauses and seeks to simulation time instead
  of silently skipping gameplay.
- **Import limits:** 20 files, 40 MiB each, 160 MiB combined, ten minutes per
  decoded track, and 256 MiB decoded PCM per track. Only the current track is
  decoded. The browser decoder necessarily allocates PCM before duration/memory
  validation; avoid unusually high-rate/multichannel recordings on small devices.
- **Performance:** Analysis yields regularly to keep the UI responsive; it does
  not yet run in a worker. Phaser is bundled locally. Scores/settings are saved,
  not imported audio, analysis caches, or in-progress sessions.

Source is separated into `audio`, `core`, `world`, `gameplay`, `input`, `scenes`,
`platforms`, and `ui` modules with shared typed state. Core simulation accepts
synthetic audio features for automated testing.

## Validation status

Automated coverage includes synthetic audio/tempo extraction, decode failures,
content hashes, single-source playback/seeking, bounded imports, seeded level
generation, safe reachability, fixed-step controls, complete rewind restoration,
playlist changes, interruption pause, persistent settings, mobile layout, and
production offline reload.

Native APK compilation could not be completed in the implementation sandbox:
`dl.google.com` DNS resolution failed while downloading Android Gradle Plugin
8.13.0. Capacitor sync succeeded; native compilation and instrumentation/device
tests still need a network-enabled build environment.

The 60 FPS target, 30 FPS minimum, five-second startup, and ±50 ms audio/visual
alignment targets are **not yet measured** on reference hardware. Beat accuracy,
mobile decoder memory pressure, and WebView-specific behavior also require
physical-device profiling. This is a playable MVP implementation, not a claim
that platform release/performance qualification is complete.
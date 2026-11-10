import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'offline-shell',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter((name) => /\.(js|css)$/.test(name)).sort();
      const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 16);
      const source = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')
        .replace('resonance-v1', `resonance-${version}`)
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(['/', '/manifest.webmanifest', ...assets.map((name) => `/${name}`)])};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  }],
});

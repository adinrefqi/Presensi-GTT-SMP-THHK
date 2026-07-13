import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

await build({ configFile: false });

for (const filename of ['app.js', 'sw.js', 'manifest.json', 'pwa-icon.png', 'style.css']) {
  copyFileSync(resolve(filename), resolve('dist', filename));
}


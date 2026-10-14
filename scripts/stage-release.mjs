import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packageRuntime } from '../src/runtime-package.mjs';
import { writeLaunchers } from './write-launchers.mjs';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
await packageRuntime({ sourceApp: manifest.sourceApp, archive: resolve('dist/app.asar'),
  destination: 'dist/runtime', profileName: 'CodexCandidates' });
await writeLaunchers();
console.log('Packaged release runtime and launchers in dist');

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { packageRuntime } from '../src/runtime-package.mjs';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
await mkdir('work', { recursive: true });
await writeFile('work/staging.json', JSON.stringify({ state: 'packing', builtAt: manifest.builtAt }));
const runtime = await packageRuntime({ sourceApp: manifest.sourceApp, archive: resolve('dist/app.asar'),
  destination: 'work/runtime', profileName: 'CodexCandidatesTest', debugPort: 9336 });
const codexHome = resolve('work/codex-home');
const settingsDirectory=resolve('work/candidate-settings');
await mkdir(settingsDirectory,{recursive:true});
// Owl chooses its profile before Electron bootstrap; app.setPath is too late.
const browserProfile = join(process.env.APPDATA, 'Codex', 'web', 'CodexCandidatesTest');
await mkdir(codexHome, { recursive: true });
const staging = { state: 'ready', builtAt: manifest.builtAt, runtime, codexHome, browserProfile,settingsDirectory };
await writeFile('work/staging.json', JSON.stringify(staging, null, 2));
console.log(JSON.stringify(staging));

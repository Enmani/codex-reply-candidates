import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, normalize } from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractFile, listPackage } from '@electron/asar';
import { transformBackend } from '../src/backend-patch.mjs';
import { transformRenderer } from '../src/renderer-patch.mjs';
import { writeAsarOverlay } from '../src/asar-overlay.mjs';
import { defaultApp } from '../src/client-package.mjs';

const sourceIndex = process.argv.indexOf('--source');
const sourceApp = resolve(sourceIndex < 0 ? defaultApp : process.argv[sourceIndex + 1]);
const archivePath = join(sourceApp, 'resources', 'app.asar');
const members = listPackage(archivePath).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
function uniqueMember(pattern) {
  const matches = members.filter(name => pattern.test(name));
  if (matches.length !== 1) throw new Error(`Expected one bundle for ${pattern}, found ${matches.length}`);
  return matches[0];
}
const backendPath = uniqueMember(/^\.vite\/build\/main-[\w-]+\.js$/);
const rendererPath = uniqueMember(/^webview\/assets\/app-primary-[\w-]+\.js$/);
const backend = transformBackend(extractFile(archivePath, normalize(backendPath)).toString('utf8'));
const renderer = transformRenderer(extractFile(archivePath, normalize(rendererPath)).toString('utf8'));
const serviceImports = [...renderer.matchAll(/import\{[^}]*\b(\w+) as op\b[^}]*\}from"([^"]+)";/g)];
if (serviceImports.length !== 1) throw new Error('Expected one renderer service import');
const outputDirectory = resolve('dist');
await mkdir(outputDirectory, { recursive: true });
for (const [name, source] of [['backend.cjs', backend], ['renderer.mjs', renderer]]) {
  const file = join(outputDirectory, name);
  await writeFile(file, source);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Generated ${name} is invalid: ${result.stderr}`);
}
const stats = await writeAsarOverlay(archivePath, join(outputDirectory, 'app.asar'),
  new Map([[backendPath, backend], [rendererPath, renderer]]));
const manifest = {
  sourceApp,
  sourceVersion: JSON.parse(extractFile(archivePath, 'package.json')).version,
  builtAt: new Date().toISOString(),
  candidateCount: 3,
  servicesModule: serviceImports[0][2],
  servicesExport: serviceImports[0][1],
  modifiedMembers: [backendPath, rendererPath],
  archiveStats: stats,
};
await writeFile(join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
console.log(JSON.stringify(manifest, null, 2));

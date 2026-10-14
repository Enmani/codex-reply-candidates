import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, normalize } from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractFile, getRawHeader } from '@electron/asar';
import { writeAsarOverlay } from './asar-overlay.mjs';

export async function packageRuntime({ sourceApp, archive, destination, profileName, debugPort }) {
  const runtime = resolve(destination);
  await mkdir(runtime, { recursive: true });
  await cp(sourceApp, runtime, { recursive: true, force: false });
  const ini = join(runtime, 'resources', 'owl-app.ini');
  const originalIni = await readFile(ini, 'utf8');
  if (originalIni.match(/^UserDataDirectoryName=.*$/gm)?.length !== 1) throw new Error('Unsupported Owl profile configuration');
  await writeFile(ini, originalIni.replace(/^UserDataDirectoryName=.*$/m, `UserDataDirectoryName=${profileName}`));
  const targetArchive = join(runtime, 'resources', 'app.asar');
  if (debugPort) {
    const earlyPath = '.vite/build/early-bootstrap.js';
    const early = extractFile(archive, normalize(earlyPath)).toString('utf8');
    const marker = 'let r=require("electron");';
    if (early.split(marker).length !== 2) throw new Error('Unsupported bootstrap');
    const withDebug = early.replace(marker, marker + `r.app.commandLine.appendSwitch('remote-debugging-port','${debugPort}');`);
    await writeAsarOverlay(archive, targetArchive, new Map([[earlyPath, withDebug]]));
  } else {
    await cp(archive, targetArchive);
  }
  const { getFileIntegrityFromBuffer } = await import(new URL('./integrity.js', import.meta.resolve('@electron/asar')));
  const header = getRawHeader(targetArchive).headerString;
  const metadata = [{ file: 'resources\\app.asar', alg: 'SHA256', value: getFileIntegrityFromBuffer(Buffer.from(header, 'utf8')).hash }];
  const metadataPath = join(runtime, 'package-metadata.json');
  await writeFile(metadataPath, JSON.stringify(metadata));
  const stamped = spawnSync('python', ['scripts/stamp-package.py', runtime, metadataPath], { encoding: 'utf8' });
  if (stamped.status !== 0) throw new Error(`Runtime packaging failed: ${stamped.stderr}`);
  return runtime;
}

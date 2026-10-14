import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function writeLaunchers(destination = 'dist') {
  const directory = resolve(destination);
  await mkdir(directory, { recursive: true });
  const source = await readFile(new URL('./launch-candidates.ps1', import.meta.url));
  await writeFile(join(directory, 'launch-candidates.ps1'), source);
  await writeFile(join(directory, '启动候选版.cmd'), '@echo off\r\npowershell.exe -NoLogo -NoProfile -File "%~dp0launch-candidates.ps1"\r\nif errorlevel 1 pause\r\n');
  await writeFile(join(directory, '恢复原版.ps1'), '\ufeff& (Join-Path $PSScriptRoot "launch-candidates.ps1") -Original\r\n');
}

if (process.argv[1]?.endsWith('write-launchers.mjs')) await writeLaunchers(process.argv[2]);

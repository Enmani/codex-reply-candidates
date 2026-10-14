import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packageRuntime } from '../src/runtime-package.mjs';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
await packageRuntime({ sourceApp: manifest.sourceApp, archive: resolve('dist/app.asar'),
  destination: 'dist/runtime', profileName: 'CodexCandidates' });
const launcher = `param([string]$ThreadId)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskSource = ${"'" + manifest.sourceApp.replaceAll("'", "''") + "'"}
$taskRunning = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskSource, [System.StringComparison]::OrdinalIgnoreCase) }
if ($taskRunning) { Write-Host '请等当前任务结束并完全退出原版 Codex，再启动候选版。'; exit 1 }
$env:CODEX_HOME = Join-Path $env:USERPROFILE '.codex'
$env:CODEX_CLI_PATH = 'C:/Users/di/AppData/Local/OpenAI/Codex/bin/2e5e00daee91c61d/codex.exe'
if (-not (Test-Path -LiteralPath $env:CODEX_CLI_PATH)) { throw '已验证的 Codex 运行组件不存在，请重新构建。' }
Remove-Item Env:CODEX_CANDIDATES_DEBUG_PORT -ErrorAction SilentlyContinue
Remove-Item Env:CODEX_ELECTRON_USER_DATA_PATH -ErrorAction SilentlyContinue
$taskArgs = @()
if ($ThreadId) { $taskArgs = @('codex://threads/' + $ThreadId) }
$taskExe = Join-Path $taskRoot 'runtime/ChatGPT.exe'
if ($taskArgs.Count) { Start-Process -FilePath $taskExe -ArgumentList $taskArgs -WorkingDirectory $taskRoot }
else { Start-Process -FilePath $taskExe -WorkingDirectory $taskRoot }
`;
// ASCII filename avoids the console code page affecting the CMD launcher.
await writeFile('dist/launch-candidates.ps1', '\ufeff' + launcher);
await writeFile('dist/启动候选版.cmd', '@echo off\r\npowershell.exe -NoLogo -NoProfile -File "%~dp0launch-candidates.ps1"\r\nif errorlevel 1 pause\r\n');
await writeFile('dist/恢复原版.ps1', '\ufeff' + `Start-Process -FilePath '${manifest.sourceApp.replaceAll("'", "''")}\\ChatGPT.exe'\r\n`);
console.log('Packaged release runtime and launchers in dist');

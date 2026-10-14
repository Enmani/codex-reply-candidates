import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('launcher uses its bundled component with a missing external path and reports the installed app', () => {
  const runtime = resolve('dist/runtime');
  const oldCache = resolve('work/missing-external-runtime/codex.exe');
  const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-File',
    resolve('scripts/launch-candidates.ps1'), '-RuntimeRoot', runtime, '-VerifyOnly'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, CODEX_CLI_PATH: oldCache } });
  const result = JSON.parse(output.trim());
  assert.equal(result.Cli.toLowerCase(), resolve(runtime, 'resources/codex.exe').toLowerCase());
  assert.match(result.CliVersion, /^codex-cli /);
  assert.equal(typeof result.OriginalRunning, 'boolean');
  assert.equal(result.InstalledPackages.length, 1);
});

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const staging = JSON.parse(await readFile('work/staging.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (staging.state !== 'ready' || staging.builtAt !== manifest.builtAt) throw new Error('Test packaging must finish for the current build before launch');
const child = spawn(join(staging.runtime, 'ChatGPT.exe'), ['--remote-debugging-port=9336', ...process.argv.slice(2)], {
  env: {
    ...process.env,
    CODEX_HOME: staging.codexHome,
    CODEX_CLI_PATH: join(staging.runtime, 'resources', 'codex.exe'),
    REPLY_CANDIDATES_DATA:staging.settingsDirectory,
  },
  stdio: 'ignore',
  detached: true,
  windowsHide: true,
});
child.unref();
console.log(JSON.stringify({ pid: child.pid, isolatedProfile: staging.browserProfile }));

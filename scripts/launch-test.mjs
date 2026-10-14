import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const staging = JSON.parse(await readFile('work/staging.json', 'utf8'));
const child = spawn(join(staging.runtime, 'ChatGPT.exe'), ['--remote-debugging-port=9336', ...process.argv.slice(2)], {
  env: {
    ...process.env,
    CODEX_HOME: staging.codexHome,
    CODEX_CLI_PATH: 'C:/Users/di/AppData/Local/OpenAI/Codex/bin/2e5e00daee91c61d/codex.exe',
  },
  stdio: 'ignore',
  detached: true,
  windowsHide: true,
});
child.unref();
console.log(JSON.stringify({ pid: child.pid, isolatedProfile: staging.browserProfile }));

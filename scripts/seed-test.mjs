import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const staging = JSON.parse(await readFile('work/staging.json', 'utf8'));
const cli = 'C:/Users/di/AppData/Local/OpenAI/Codex/bin/2e5e00daee91c61d/codex.exe';
await cp(join(homedir(), '.codex', 'auth.json'), join(staging.codexHome, 'auth.json'));
const preferencesPath = join(staging.codexHome, '.codex-global-state.json');
const originalPreferences = JSON.parse(await readFile(join(homedir(), '.codex', '.codex-global-state.json'), 'utf8'));
let preferences = {};
try { preferences = JSON.parse(await readFile(preferencesPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
preferences['electron-persisted-atom-state'] ??= {};
preferences['electron-persisted-atom-state']['electron:onboarding-projectless-completed'] =
  originalPreferences['electron-persisted-atom-state']?.['electron:onboarding-projectless-completed'] === true;
preferences['electron-initial-follow-up-queue-mode'] = originalPreferences['electron-initial-follow-up-queue-mode'] ?? 'queue';
await writeFile(preferencesPath, JSON.stringify(preferences, null, 2));
const seedDirectory = resolve('work/seed');
await mkdir(seedDirectory, { recursive: true });
const child = spawn(cli, ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--cd', seedDirectory,
  '我在测试回复候选。请用中文简短解释列表和表格分别适合什么情况。只回答这个问题，不调用工具，不改动文件。'], {
  env: { ...process.env, CODEX_HOME: staging.codexHome },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; });
child.stderr.on('data', data => { stderr += data; });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
const events = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const started = events.find(event => event.type === 'thread.started');
await writeFile('work/seed-result.json', JSON.stringify({ code, events, stderr }, null, 2));
if (code !== 0 || !started?.thread_id) throw new Error(`Seed conversation failed; see work/seed-result.json (exit ${code})`);
await writeFile('work/seed-thread.json', JSON.stringify({ threadId: started.thread_id }));
console.log(JSON.stringify({ code, threadId: started.thread_id, eventTypes: events.map(event => event.type) }));

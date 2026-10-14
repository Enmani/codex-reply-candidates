import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('work/integrated-install');
const codexHome = resolve('work/integrated-home');
const settingsDirectory = resolve('work/integrated-settings');
async function run(program, args, env) {
  const child = spawn(program, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept); });
  if (code !== 0) throw Error(errors || `Test setup failed (${code})`);
  return output;
}
const env = { ...process.env, REPLY_CANDIDATES_TEST_DEBUG_PORT: '9338', REPLY_CANDIDATES_TEST_PROFILE: 'CodexIntegratedTest' };
const installed = JSON.parse(await run(resolve('dist/plugin/CodexReplyCandidates-Setup.exe'),
  ['--headless', '--destination', root, '--codex-home', codexHome], env));
if (!installed.installed) throw Error('The actual installer did not complete');
await mkdir(settingsDirectory, { recursive: true });
await writeFile(join(settingsDirectory, 'settings.json'), JSON.stringify({ enabled: true, count: 3 }));
// Native plugin subprocesses do not inherit arbitrary parent environment variables.
// Set the private test data path in this test marketplace's MCP configuration.
const mcpPath = join(root, 'plugins/reply-candidates/mcp.json');
const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
mcp.mcpServers.reply_candidates.env = { REPLY_CANDIDATES_DATA: settingsDirectory };
await writeFile(mcpPath, JSON.stringify(mcp, null, 2));
const cli = join(installed.runtime, 'resources/codex.exe');
await run(cli, ['plugin', 'add', installed.pluginId, '--json'], { ...process.env, CODEX_HOME: codexHome });
for (const file of ['auth.json', '.codex-global-state.json', 'sessions']) {
  await cp(resolve('work/codex-home', file), join(codexHome, file), { recursive: true, force: true });
}
const child = spawn(join(installed.runtime, 'ChatGPT.exe'), [], {
  env: { ...process.env, CODEX_HOME: codexHome, CODEX_CLI_PATH: cli, REPLY_CANDIDATES_DATA: settingsDirectory },
  windowsHide: true, detached: true, stdio: 'ignore',
});
child.unref();
const result = { ...installed, codexHome, settingsDirectory, pid: child.pid, debugPort: 9338 };
await writeFile('work/installed-staging.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

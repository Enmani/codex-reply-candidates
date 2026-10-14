import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const staging = JSON.parse(await readFile('work/staging.json', 'utf8'));
const countArgument = process.argv.find(value => /^[1-3]$/.test(value));
const set = process.argv.includes('--off') ? { enabled: false } : { enabled: true, count: Number(countArgument ?? 3) };
const client = new Client({ name: 'reply-candidates-settings-test', version: '0.2.0' });
await client.connect(new StdioClientTransport({
  command: resolve('dist/plugin/CodexReplyCandidates-Setup.exe'), args: ['--mcp'],
  env: { ...process.env, REPLY_CANDIDATES_DATA: staging.settingsDirectory }, stderr: 'pipe',
}));
try {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['settings_read', 'settings_update']);
  assert.ok(tools.find(tool => tool.name === 'settings_read').outputSchema);
  assert.equal(client.getServerCapabilities().experimental['openai/settings'].readTool, 'settings_read');
  await client.callTool({ name: 'settings_update', arguments: { set } });
  const result = (await client.callTool({ name: 'settings_read', arguments: {} })).structuredContent;
  assert.equal(result.schema.properties.count.minimum, 1);
  assert.equal(result.schema.properties.count.maximum, 3);
  assert.equal(result.values.enabled, set.enabled);
  if (set.count) assert.equal(result.values.count, set.count);
  console.log(JSON.stringify({ settingsProtocolPassed: true, values: result.values }));
} finally { await client.close(); }

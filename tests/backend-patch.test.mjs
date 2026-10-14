import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  candidatePluginEnabled,
  createCandidatePromptForCount,
  createCandidateSchema,
  getReplyCandidatesSettings,
  identifyPredictionSchema,
  parseCandidateSettings,
  readCandidateSettings,
  requestCandidates,
  runCandidatePrediction,
  transformBackend,
} from '../src/backend-patch.mjs';
import { readBundledText, loadShippedSchemaLibrary } from '../src/client-package.mjs';
const fixture = readBundledText(/^\.vite\/build\/main-[\w-]+\.js$/).text;

const readSettings = () => ({ enabled: true, count: 2 });
const pluginEnabled = async () => true;

test('candidate refresh uses its own cache namespace and tags the forwarded request', async () => {
  const events = [];
  let release;
  const cancellation = new Promise(resolve => { release = resolve; });
  const controller = {
    queries: {
      async cancelQueries({ queryKey }) { events.push(['cancel', queryKey]); await cancellation; },
      removeQueries(options) { events.push(['remove', options]); },
      async fetchQuery({ queryKey, queryFn }) { events.push(['fetch', queryKey]); return queryFn({ signal: 'signal' }); },
    },
  };
  const runner = async (_controller, params, signal) => ({ params, signal });
  const params = { hostId: 'local', threadId: 'thread-a', latestTurnId: 'turn-2', forceRefresh: true };
  const pending = requestCandidates(controller, params, undefined, readSettings, pluginEnabled, runner);
  await Promise.resolve();
  assert.deepEqual(events, [['cancel', ['codex-reply-candidates', 'local', 'thread-a']]]);
  release();
  const result = await pending;
  assert.deepEqual(events.map(event => event[0]), ['cancel', 'remove', 'remove', 'fetch']);
  assert.deepEqual(events.at(-1)[1], ['codex-reply-candidates', 'local', 'thread-a', 'turn-2', 2]);
  assert.equal(result.params.replyCandidates, true);
  assert.equal(result.params.candidateCount, 2);
  assert.equal(result.signal, 'signal');
});

test('normal candidate reads remove only older candidate turns and never touch stock keys', async () => {
  let removed;
  const controller = {
    queries: {
      removeQueries: options => { removed = options; },
      fetchQuery: options => options.queryKey,
      cancelQueries: () => { throw new Error('Normal reads must not cancel cached generation'); },
    },
  };
  assert.deepEqual(await requestCandidates(controller,
    { hostId: 'remote', threadId: 'a', latestTurnId: 'new' }, null, readSettings, pluginEnabled, async () => null),
  ['codex-reply-candidates', 'remote', 'a', 'new', 2]);
  assert.deepEqual(removed.queryKey, ['codex-reply-candidates', 'remote', 'a']);
  assert.equal(removed.predicate({ queryKey: ['codex-reply-candidates', 'remote', 'a', 'old', 2] }), true);
  assert.equal(removed.predicate({ queryKey: ['codex-reply-candidates', 'remote', 'a', 'new', 2] }), false);
});

test('disabled or invalid settings fail closed without touching native prediction setting', async () => {
  let calls = 0;
  const controller = { queries: { fetchQuery: () => { calls += 1; } } };
  assert.equal(await requestCandidates(controller, {}, null, () => ({ enabled: false, count: 3 }), pluginEnabled, async () => null), null);
  assert.equal(await requestCandidates(controller, {}, null, () => ({ enabled: true, count: 4 }), pluginEnabled, async () => null), null);
  assert.equal(calls, 0);
  assert.deepEqual(parseCandidateSettings({ enabled: true, count: 0 }), { enabled: false, count: null });
  assert.deepEqual(parseCandidateSettings({ enabled: false, count: 3 }), { enabled: false, count: 3 });
});

test('candidate settings read from configured directory or default local app data', () => {
  const files = new Map([
    ['C:/reply/settings.json', JSON.stringify({ enabled: false, count: 1 })],
    ['C:/Users/test/AppData/Local/Codex/reply-candidates/settings.json', JSON.stringify({ enabled: true, count: 2 })],
  ]);
  const fsModule = { readFileSync: path => { if (!files.has(path)) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return files.get(path); } };
  const pathModule = { join: (...parts) => parts.join('/') };
  const osModule = { homedir: () => 'C:/Users/test' };
  assert.deepEqual(readCandidateSettings(fsModule, pathModule, osModule, { REPLY_CANDIDATES_DATA: 'C:/reply' }), { enabled: false, count: 1 });
  assert.deepEqual(readCandidateSettings(fsModule, pathModule, osModule, {}), { enabled: true, count: 3 });
  assert.deepEqual(readCandidateSettings(fsModule, pathModule, osModule, { REPLY_CANDIDATES_DATA: 'C:/missing' }), { enabled: true, count: 3 });
  assert.deepEqual(readCandidateSettings({ readFileSync: () => { throw Object.assign(new Error('bad'), { code: 'EACCES' }); } }, pathModule, osModule, {}), { enabled: false, count: null });
});

test('plugin config/read disables candidate mode when the original connection reports it disabled', async () => {
  const disabled = {
    connections: { getConnection: () => ({ sendAppServerRequest: async () => ({ config: { plugins: { 'reply-candidates@codex-reply-candidates': { enabled: false } } } }) }) },
  };
  const enabled = {
    connections: { getConnection: () => ({ sendAppServerRequest: async () => ({ config: { plugins: {} } }) }) },
  };
  assert.equal(await candidatePluginEnabled(disabled, 'local'), false);
  assert.equal(await candidatePluginEnabled(enabled, 'local'), true);
});

test('effective candidate settings include the host plugin state', async () => {
  const settings = () => ({ enabled: true, count: 2 });
  assert.deepEqual(await getReplyCandidatesSettings({}, 'local', settings, async () => true), { enabled: true, count: 2 });
  assert.deepEqual(await getReplyCandidatesSettings({}, 'local', settings, async () => false), { enabled: false, count: null });
  assert.deepEqual(await getReplyCandidatesSettings({}, 'local', () => ({ enabled: false, count: 3 }), async () => {
    throw new Error('disabled settings must not read plugin config');
  }), { enabled: false, count: 3 });
});

test('disabling candidate settings cancels only the candidate query namespace', async () => {
  const cancelled = [];
  const controller = { queries: { cancelQueries: options => { cancelled.push(options.queryKey); } } };
  const result = await getReplyCandidatesSettings(controller, 'local', () => ({ enabled: false, count: 3 }), async () => true);
  assert.deepEqual(result, { enabled: false, count: 3 });
  assert.deepEqual(cancelled, [['codex-reply-candidates']]);
});

test('candidate results are discarded when settings change during generation', async () => {
  let current = { enabled: true, count: 2 };
  const controller = {
    queries: {
      removeQueries: () => {},
      fetchQuery: options => options.queryFn({ signal: new AbortController().signal }),
    },
  };
  const result = await requestCandidates(controller, { hostId: 'local', threadId: 'thread', latestTurnId: 'turn' }, null,
    () => current, pluginEnabled, async () => {
      current = { enabled: false, count: 2 };
      return { suggestions: ['stale'] };
    });
  assert.equal(result, null);
});

test('candidate runner uses the separate schema and keeps the stock runner untouched', async () => {
  let request;
  const controller = {
    debugLog: [],
    connections: {
      getConnection: () => ({
        hostConfig: { kind: 'local' },
        appServerVersion: '1.0.0',
        registerInternalNotificationHandler: () => () => {},
        resumeThread: async () => ({ model: 'gpt-test', modelProvider: 'openai', reasoningEffort: 'standard', serviceTier: 'default', collaborationMode: { mode: 'default' } }),
      }),
    },
    getConfig: async () => ({ is_enabled: true, sample_rate: 0, prompt: 'base prompt', prompt_version: 'v1', prediction_reasoning_effort: null }),
    queries: { removeQueries: () => {} },
  };
  const requestLibrary = {
    dt: async options => {
      request = options;
      options.onTemporaryThreadCreated({ threadId: 'prediction-thread' });
      options.onTurnCompleted({ turnId: 'prediction-turn' });
      return { suggestions: ['第一条', '第二条'] };
    },
  };
  const result = await runCandidatePrediction(controller, {
    hostId: 'local', threadId: 'source-thread', latestTurnId: 'source-turn', generationTrigger: 'catch_up', candidateCount: 2, forceRefresh: true,
  }, new AbortController().signal, null, loadShippedSchemaLibrary(), requestLibrary, { Ti: () => true });
  assert.deepEqual(result.suggestions, ['第一条', '第二条']);
  assert.equal(result.text, '第一条');
  assert.match(request.prompt, /exactly 2 alternative next USER messages/);
  assert.equal(request.responseSchema.safeParse({ suggestions: ['a', 'b'] }).success, true);
  assert.equal(request.responseSchema.safeParse({ suggestions: ['a', 'a'] }).success, false);
});

test('candidate instructions retain source guidance and request complete user replies', () => {
  const prompt = createCandidatePromptForCount('Original account guidance', 3);
  assert.ok(prompt.startsWith('Original account guidance\n\n'));
  assert.match(prompt, /exactly 3 alternative next USER messages/);
  assert.match(prompt, /Do not execute/);
  assert.match(createCandidatePromptForCount('base', 2), /exactly 2 alternative next USER messages/);
});

test('transforms only the service dispatch and preserves the stock request, schema, and run path', () => {
  const { declaration } = identifyPredictionSchema(fixture);
  const settingName = /request\(e,t\)\{if\(!this\.settings\.getEffective\((\w+)\.key\)\)/.exec(fixture)?.[1];
  const originalRequest = 'request(e,t){if(!this.settings.getEffective(ET.key))return Promise.resolve(null);let{hostId:n,threadId:r,latestTurnId:i}=e;return this.queries.removeQueries({queryKey:[n,r],predicate:e=>e.queryKey[2]!==i}),this.queries.fetchQuery({queryKey:[n,r,i],queryFn:({signal:n})=>this.runPrediction(e,n,t)})}'.replace('ET.key', `${settingName}.key`);
  const originalRun = 'async runPrediction({hostId:e,threadId:t,latestTurnId:n,generationTrigger:r},a,o)';
  const result = transformBackend(fixture);
  assert.ok(result.includes(declaration));
  assert.ok(result.includes(originalRequest));
  assert.ok(result.includes(originalRun));
  const stockSampling = 'if(l<1&&Math.random()>=l)return null;';
  assert.equal(fixture.split(stockSampling).length, result.split(stockSampling).length);
  assert.ok(result.includes(stockSampling));
  assert.match(result, /replyCandidates\?__codexReplyCandidatesRequest/);
  assert.match(result, /getReplyCandidatesSettings\(\{hostId:e\}=\{\}\)/);
  assert.match(result, /codex-reply-candidates/);
  assert.match(result, /candidateCount/);
  assert.throws(() => transformBackend(result), /already installed/);
  assert.throws(() => transformBackend('Unrelated client'), /Unsupported Codex build/);
});

test('generated runtime helper reads a valid settings file without native settings access', () => {
  const transformed = transformBackend(fixture);
  const helperSource = transformed.slice(transformed.indexOf('function __codexReplyCandidatesReadSettings'));
  const helpers = runInNewContext(`${helperSource};({
    read: __codexReplyCandidatesReadSettings,
    plugin: __codexReplyCandidatesPluginEnabled,
    effective: __codexReplyCandidatesEffectiveSettings,
    prompt: __codexReplyCandidatesPrompt,
    schema: __codexReplyCandidatesSchema,
    run: __codexReplyCandidatesRun,
    requestCore: __codexReplyCandidatesRequestCore,
    request: __codexReplyCandidatesRequest,
    get: __codexReplyCandidatesGetSettings,
  })`, {});
  for (const helper of Object.values(helpers)) assert.equal(typeof helper, 'function');
  const fsModule = { readFileSync: () => JSON.stringify({ enabled: true, count: 2 }) };
  const pathModule = { join: (...parts) => parts.join('/') };
  const osModule = { homedir: () => 'C:/Users/test' };
  const settings = helpers.read(fsModule, pathModule, osModule, { REPLY_CANDIDATES_DATA: 'C:/reply' });
  assert.equal(settings.enabled, true);
  assert.equal(settings.count, 2);
  return helpers.effective({}, 'local', () => ({ enabled: true, count: 2 }), async () => true)
    .then(effective => assert.deepEqual(effective, { enabled: true, count: 2 }));
});

test('the shipped schema library validates one to three distinct nonempty replies', () => {
  const n = loadShippedSchemaLibrary();
  for (const count of [1, 2, 3]) {
    const { schema, json } = createCandidateSchema(n, count);
    assert.equal(schema.safeParse({ suggestions: Array.from({ length: count }, (_, index) => `reply-${index}`) }).success, true);
    assert.equal(schema.safeParse({ suggestions: Array.from({ length: count }, () => 'same') }).success, count === 1);
    assert.equal(JSON.parse(json).properties.suggestions.minItems, count);
    assert.equal(JSON.parse(json).properties.suggestions.maxItems, count);
  }
});

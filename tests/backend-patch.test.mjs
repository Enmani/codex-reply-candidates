import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createCandidatePrompt, requestCandidates, transformBackend, shouldGeneratePrediction } from '../src/backend-patch.mjs';
import { readBundledText, loadShippedSchemaLibrary } from '../src/client-package.mjs';

const fixture = readBundledText(/^\.vite\/build\/main-[\w-]+\.js$/).text;

test('refresh waits for cancellation before removing the cached turn or starting another generation', async () => {
  const events = [];
  let release;
  const cancellation = new Promise(resolve => { release = resolve; });
  const controller = {
    settings: { getEffective: () => true },
    queries: {
      async cancelQueries({ queryKey }) { events.push(['cancel', queryKey]); await cancellation; },
      removeQueries(options) { events.push(['remove', options]); },
      async fetchQuery({ queryKey, queryFn }) { events.push(['fetch', queryKey]); return queryFn({ signal: 'signal' }); },
    },
    runPrediction: async (params, signal) => ({ params, signal }),
  };
  const params = { hostId: 'local', threadId: 'thread-a', latestTurnId: 'turn-2', forceRefresh: true };
  const pending = requestCandidates(controller, params, undefined, 'enabled');
  assert.deepEqual(events, [['cancel', ['local', 'thread-a']]]);
  release();
  const result = await pending;
  assert.deepEqual(events.map(event => event[0]), ['cancel', 'remove', 'remove', 'fetch']);
  assert.deepEqual(events.at(-1)[1], ['local', 'thread-a', 'turn-2']);
  assert.deepEqual(result, { params, signal: 'signal' });
});

test('normal reads reuse the current source-turn key and remove only older turns', async () => {
  let removed;
  const controller = {
    settings: { getEffective: () => true },
    queries: {
      removeQueries: options => { removed = options; },
      fetchQuery: options => options.queryKey,
      cancelQueries: () => { throw new Error('Normal reads must not cancel cached generation'); },
    },
  };
  assert.deepEqual(await requestCandidates(controller,
    { hostId: 'remote', threadId: 'a', latestTurnId: 'new' }, null, 'enabled'), ['remote', 'a', 'new']);
  assert.equal(removed.predicate({ queryKey: ['remote', 'a', 'old'] }), true);
  assert.equal(removed.predicate({ queryKey: ['remote', 'a', 'new'] }), false);
});

test('disabled setting never starts or cancels a generation', async () => {
  assert.equal(await requestCandidates({ settings: { getEffective: () => false } }, {}, null, 'enabled'), null);
});

test('manual refresh generates without random sampling while automatic generation retains server sampling', () => {
  const mustNotSample = () => { throw new Error('Explicit requests must not sample'); };
  assert.equal(shouldGeneratePrediction(0, true, mustNotSample), true);
  assert.equal(shouldGeneratePrediction(1, false, mustNotSample), true);
  assert.equal(shouldGeneratePrediction(0.2, false, () => 0.3), false);
  assert.equal(shouldGeneratePrediction(0.2, false, () => 0.1), true);
});

test('candidate instructions retain source guidance and request complete user replies', () => {
  const prompt = createCandidatePrompt('Original account guidance');
  assert.ok(prompt.startsWith('Original account guidance\n\n'));
  assert.match(prompt, /exactly three alternative next USER messages/);
  assert.match(prompt, /Do not execute/);
});

test('transforms the installed bundle and refuses already-patched or unidentified bundles', async () => {
  const result = transformBackend(fixture);
  assert.ok(result.includes('text:b.suggestions[0],suggestions:b.suggestions'));
  assert.throws(() => transformBackend(result), /already installed/);
  assert.throws(() => transformBackend('Unrelated client'), /Unsupported Codex build/);
});

test('the shipped schema library validates three nonempty distinct replies and generates the JSON schema', async () => {
  const source = transformBackend(fixture);
  const declaration = source.slice(source.indexOf('var TT='), source.indexOf('async function fge('));
  const n = loadShippedSchemaLibrary();
  const { schema, json } = runInNewContext(declaration+';({schema:TT,json:dge})', { n });
  assert.equal(schema.safeParse({ suggestions: ['继续实现', '先说明方案', '检查现有结果'] }).success, true);
  assert.equal(schema.safeParse({ suggestions: ['只有一条'] }).success, false);
  assert.equal(schema.safeParse({ suggestions: ['继续', ' 继续 ', '解释'] }).success, false);
  assert.equal(schema.safeParse({ suggestions: ['继续', '', '解释'] }).success, false);
  assert.equal(JSON.parse(json).properties.suggestions.minItems, 3);
  assert.equal(JSON.parse(json).properties.suggestions.maxItems, 3);
});

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inspectTestRuntime } from './cdp-read.mjs';

const { threadId } = JSON.parse(await readFile('work/seed-thread.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
await mkdir('docs/images', { recursive: true });
const reports = [];
await inspectTestRuntime(`(${async function prepare(modulePath, seed) {
  const module=await import('./assets/'+modulePath.replace(/^\.\//,''));
  await module.fN.windowNavigation.navigateInOwnerWindow({path:'/local/'+seed});
  await new Promise(resolve=>setTimeout(resolve,2000));
  let scope;
  function visit(node){
    if(!node)return;
    for(let hook=node.memoizedState;hook&&typeof hook==='object';hook=hook.next){
      const value=hook.memoizedState?.current;
      if(value?.queryClient&&typeof value.get==='function')scope=value;
    }
    visit(node.child);visit(node.sibling);
  }
  visit(window.__codexRoot._internalRoot.current);
  if(!scope)throw Error('Native state scope is unavailable');
  window.__replyTestManager=module['y$t'](scope,'local');
}.toString()})(${JSON.stringify(manifest.servicesModule)},${JSON.stringify(threadId)})`,undefined,30000,9338);
for (const count of [1, 2, 3]) {
  const result = await inspectTestRuntime(`(${async function test(seed, modulePath, count) {
    const module = await import('./assets/' + modulePath.replace(/^\.\//, ''));
    const services = module.fN;
    const updated = await window.__replyTestManager.sendRequest('mcpServer/tool/call', {
      threadId: seed, server: 'reply_candidates', tool: 'settings_update', arguments: { set: { enabled: true, count } },
    });
    if (updated.structuredContent?.values?.count !== count) throw Error('Native settings update failed');
    await services.windowNavigation.navigateInOwnerWindow({ path: '/' });
    await new Promise(resolve => setTimeout(resolve, 500));
    await services.windowNavigation.navigateInOwnerWindow({ path: '/local/' + seed });
    function panel() {
      let found;
      function visit(node) {
        if (!node) return;
        if (node.type?.name === 'CodexMultiPredictionPanel') found = node;
        visit(node.child); visit(node.sibling);
      }
      visit(window.__codexRoot._internalRoot.current);
      return found?.key?.startsWith('local:' + seed + ':') ? found.memoizedProps : null;
    }
    const deadline = Date.now() + 60000;
    while ((panel()?.candidateCount !== count || panel()?.prediction?.suggestions?.length !== count) && Date.now() < deadline) {
      if (panel()?.error) throw Error('Candidate generation failed');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const props = panel(), element = document.querySelector('[data-codex-multi-predictions]');
    if (props?.candidateCount !== count || props.prediction?.suggestions?.length !== count || !element) throw Error('Live count did not match');
    if (!props.prediction.suggestions.every(text => element.innerText.includes(text))) throw Error('Candidate text missing');
    const r = element.getBoundingClientRect(), x = Math.max(0, r.x - 8), y = Math.max(0, r.y - 8);
    return { count, actualNativeSettingsCall: true, automaticGeneration: true, suggestions: props.prediction.suggestions,
      screenshotClip: { x, y, width: Math.min(innerWidth - x, r.width + 16), height: innerHeight - y, scale: 1 } };
  }.toString()})(${JSON.stringify(threadId)},${JSON.stringify(manifest.servicesModule)},${count})`,
  count === 2 ? undefined : `docs/images/client-candidates-${count === 1 ? 'one' : 'three'}.png`, 90000, 9338);
  assert.equal(result.count, count);
  delete result.screenshotClip;
  reports.push(result);
  console.log(JSON.stringify({ count, passed: true }));
}
const disabled = await inspectTestRuntime(`(${async function disable(seed, modulePath) {
  const services = (await import('./assets/' + modulePath.replace(/^\.\//, ''))).fN;
  const grayText = document.body.innerText.split('Press Tab to accept')[0].split('\n').filter(Boolean).at(-1);
  if (!document.body.innerText.includes('Press Tab to accept')) throw Error('Native gray prediction is not visible before disable');
  await window.__replyTestManager.sendRequest('mcpServer/tool/call', {
    threadId: seed, server: 'reply_candidates', tool: 'settings_update', arguments: { set: { enabled: false } },
  });
  await services.windowNavigation.navigateInOwnerWindow({ path: '/' });
  await new Promise(resolve => setTimeout(resolve, 500));
  await services.windowNavigation.navigateInOwnerWindow({ path: '/local/' + seed });
  const deadline = Date.now() + 15000;
  while ((!document.body.innerText.includes('Press Tab to accept') || document.querySelector('[data-codex-multi-predictions]')) && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 100));
  const settings = await services.cumberbatch.getReplyCandidatesSettings({ hostId: 'local' });
  if (settings.enabled || document.querySelector('[data-codex-multi-predictions]')) throw Error('Candidate panel remained after disable');
  if (!document.body.innerText.includes(grayText) || !document.body.innerText.includes('Press Tab to accept')) throw Error('Native gray prediction changed');
  const composer = [...document.querySelectorAll('[data-codex-composer]')].find(element=>element.getBoundingClientRect().width>100);
  if(!composer)throw Error('Visible composer is unavailable');
  const r = composer.getBoundingClientRect(), y = Math.max(0, r.y - 16);
  return { candidatePanelHidden: true, sameNativeGrayPredictionVisible: true, screenshotClip: { x: Math.max(0, r.x - 16), y,
    width: Math.min(innerWidth, r.width + 32), height: innerHeight - y, scale: 1 } };
}.toString()})(${JSON.stringify(threadId)},${JSON.stringify(manifest.servicesModule)})`, 'docs/images/native-autofill-disabled.png', 30000, 9338);
delete disabled.screenshotClip;
await writeFile('work/installed-settings-result.json', JSON.stringify({ reports, disabled }, null, 2));
console.log(JSON.stringify(disabled));

import { readFile, writeFile } from 'node:fs/promises';
import { inspectTestRuntime } from './cdp-read.mjs';

// Functional integration through the isolated copy's real services and composer
// hooks. This does not click UI buttons or operate the user's existing threads.
const { threadId } = JSON.parse(await readFile('work/seed-thread.json', 'utf8'));
const expression = `(${async function integration(seedId, shouldSend) {
  const services = (await import('./assets/app-shared-737655e1fb23.js')).fN;
  await services.windowNavigation.navigateInOwnerWindow({ path: '/local/' + seedId });
  function panel() {
    let found;
    function visit(node) {
      if (!node) return;
      if (node.type?.name === 'CodexMultiPredictionPanel') found = node;
      visit(node.child);
      visit(node.sibling);
    }
    visit(window.__codexRoot._internalRoot.current);
    if (!found?.key?.startsWith('local:' + seedId + ':')) return null;
    return found.memoizedProps;
  }
  const deadline = Date.now() + 15000;
  while (!panel() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  const props = panel();
  if (!props) throw new Error('Isolated seed panel did not mount');
  if (props.controller.getText().trim()) throw new Error('Test composer already has a draft');
  const first = await props.requestPrediction();
  if (first?.suggestions?.length !== 3) throw new Error('Panel request did not return three candidates: ' + JSON.stringify(first));
  props.onPrediction(first);
  await new Promise(resolve => setTimeout(resolve, 250));
  const renderedFirst = document.querySelector('[data-codex-multi-predictions]')?.innerText ?? '';
  if (!first.suggestions.every(text => renderedFirst.includes(text))) throw new Error('Actual panel did not render the candidate texts');
  const refreshed = await panel().requestPrediction();
  if (refreshed?.suggestions?.length !== 3 || refreshed.predictionThreadId === first.predictionThreadId) {
    throw new Error('Panel refresh did not create a new three-candidate prediction');
  }
  panel().onPrediction(refreshed);
  await new Promise(resolve => setTimeout(resolve, 250));
  const current = panel();
  current.controller.setText(refreshed.suggestions[0]);
  if (current.controller.getText() !== refreshed.suggestions[0]) throw new Error('Real composer did not accept the draft');
  current.controller.setText('');
  let submitted = null;
  if (shouldSend) {
    submitted = await panel().submitText(refreshed.suggestions[0]);
    if (submitted !== true) throw new Error('Real composer submission was not accepted');
  }
  return {
    threadId: seedId,
    firstFork: first.predictionThreadId,
    refreshedFork: refreshed.predictionThreadId,
    candidates: refreshed.suggestions,
    actualPanelRendered: true,
    actualComposerDraftAccepted: true,
    submitted,
  };
}.toString()})(${JSON.stringify(threadId)},${process.argv.includes('--send')})`;

const result = await inspectTestRuntime(expression, undefined, 120000);
await writeFile('work/runtime-integration.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

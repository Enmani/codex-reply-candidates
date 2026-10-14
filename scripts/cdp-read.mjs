import { writeFile } from 'node:fs/promises';

export async function withTestRuntime(action, timeoutMs = 15000, debugPort = 9336, surface = 'main') {
  if (![9336, 9337,9338].includes(debugPort)) throw new Error('Only isolated development ports are allowed');
  if (!['main','plugin'].includes(surface)) throw new Error('Unsupported development surface');
  let matches = [];
  const deadline=Date.now()+Math.min(timeoutMs,30000);
  while(matches.length === 0 && Date.now() < deadline){
    try {
      const targets = await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      matches = targets.filter(target => surface === 'main'
        ? target.type === 'page' && target.url === 'app://-/index.html'
        : target.type === 'webview' && /^codex-sandbox:\/\/mcp-app-/.test(target.url));
    } catch(error) { if(error.cause?.code !== 'ECONNREFUSED') throw error; }
    if(matches.length === 0) await new Promise(r=>setTimeout(r,200));
  }
  if (matches.length !== 1) throw new Error(`Expected one private test main page; found ${matches.length}`);
  const socket = new WebSocket(matches[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
  };
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out reading ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    return await action(request);
  } finally { socket.close(); }
}

export async function inspectTestRuntime(expression, screenshotPath, timeoutMs = 15000, debugPort = 9336, surface = 'main') {
  return withTestRuntime(async request => {
    const result = await request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    if (screenshotPath) {
      const capture = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        ...(result.result.value?.screenshotClip ? { clip: result.result.value.screenshotClip } : {}) });
      await writeFile(screenshotPath, Buffer.from(capture.data, 'base64'));
    }
    return result.result.value;
  }, timeoutMs, debugPort, surface);
}

if (process.argv[1]?.endsWith('cdp-read.mjs')) {
  console.log(JSON.stringify(await inspectTestRuntime(
    '({text:document.body.innerText,panels:document.querySelectorAll("[data-codex-multi-predictions]").length,href:location.href})',
    process.argv.includes('--screenshot') ? 'work/runtime-view.png' : undefined), null, 2));
}

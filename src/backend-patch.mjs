const originalRequest = 'request(e,t){if(!this.settings.getEffective(ET.key))return Promise.resolve(null);let{hostId:n,threadId:r,latestTurnId:i}=e;return this.queries.removeQueries({queryKey:[n,r],predicate:e=>e.queryKey[2]!==i}),this.queries.fetchQuery({queryKey:[n,r,i],queryFn:({signal:n})=>this.runPrediction(e,n,t)})}';
const originalRun = 'async runPrediction({hostId:e,threadId:t,latestTurnId:n,generationTrigger:r},a,o)';
const originalServiceMethod = 'requestUserMessagePrediction(e,t){return this.controller.request(e,e=>{t?.(e).catch(()=>{})})}';

function candidatePromptForCount(basePrompt, count) {
  return `${basePrompt}\n\nFor this request, generate exactly ${count} alternative next USER messages based on the conversation above. Each candidate must be a complete message the user could send now. Match the user's language, tone, preferences and current scope. Make the alternatives meaningfully different while remaining plausible. Keep necessary specifics; do not invent work, permissions or commitments. Do not answer as the assistant or describe your reasoning. Only write candidate messages. Do not execute the proposed work or call tools. Return only the requested JSON.`;
}

export function createCandidatePromptForCount(basePrompt, count) {
  return candidatePromptForCount(basePrompt, count);
}

export function parseCandidateSettings(value) {
  if (value == null || typeof value !== 'object' || typeof value.enabled !== 'boolean' || !Number.isInteger(value.count) || value.count < 1 || value.count > 3) {
    return { enabled: false, count: null };
  }
  return { enabled: value.enabled, count: value.count };
}

export function readCandidateSettings(fsModule, pathModule, osModule, env = process.env) {
  const defaults = { enabled: true, count: 3 };
  const configured = env?.REPLY_CANDIDATES_DATA;
  const base = configured || pathModule.join(env?.LOCALAPPDATA || osModule.homedir(), 'Codex', 'reply-candidates');
  const file = String(base).toLowerCase().endsWith('.json') ? base : pathModule.join(base, 'settings.json');
  let raw;
  try {
    raw = fsModule.readFileSync(file, 'utf8');
  } catch (error) {
    return error?.code === 'ENOENT' ? defaults : { enabled: false, count: null };
  }
  try {
    const value = JSON.parse(raw);
    if (value == null || typeof value !== 'object' || typeof value.enabled !== 'boolean' || !Number.isInteger(value.count) || value.count < 1 || value.count > 3) {
      return { enabled: false, count: null };
    }
    return { enabled: value.enabled, count: value.count };
  } catch {
    return { enabled: false, count: null };
  }
}

export async function candidatePluginEnabled(controller, hostId) {
  const connection = controller?.connections?.getConnection?.(hostId);
  if (typeof connection?.sendAppServerRequest !== 'function') return true;
  try {
    const result = await connection.sendAppServerRequest('config/read', { includeLayers: false });
    const plugins = result?.config?.plugins;
    const entries = [plugins?.['reply-candidates@codex-reply-candidates'], plugins?.['reply-candidates']];
    return !entries.some(entry => entry?.enabled === false);
  } catch {
    return true;
  }
}

export async function getReplyCandidatesSettings(controller, hostId, readSettings, pluginEnabled) {
  const settings = readSettings?.() || { enabled: false, count: null };
  const cancelCandidates = async () => {
    try {
      const pending = controller?.queries?.cancelQueries?.({ queryKey: ['codex-reply-candidates'] });
      await pending;
    } catch {}
  };
  if (!settings.enabled || !Number.isInteger(settings.count) || settings.count < 1 || settings.count > 3) {
    await cancelCandidates();
    return settings;
  }
  if (!(await pluginEnabled(controller, hostId))) {
    await cancelCandidates();
    return { enabled: false, count: null };
  }
  return settings;
}

export async function requestCandidates(controller, params, onIneligible, readSettings, pluginEnabled, runCandidate) {
  const settings = readSettings();
  if (!settings?.enabled || !Number.isInteger(settings.count) || settings.count < 1 || settings.count > 3) return null;
  const { hostId, threadId, latestTurnId, forceRefresh } = params;
  if (!(await pluginEnabled(controller, hostId))) return null;

  const rootKey = ['codex-reply-candidates', hostId, threadId];
  const queryKey = [...rootKey, latestTurnId, settings.count];
  const candidateParams = { ...params, replyCandidates: true, candidateCount: settings.count };
  const safeIneligible = value => {
    try {
      const result = onIneligible?.(value);
      result?.catch?.(() => {});
    } catch {}
  };
  if (forceRefresh === true) {
    await controller.queries.cancelQueries({ queryKey: rootKey });
    controller.queries.removeQueries({ queryKey: rootKey });
  }
  controller.queries.removeQueries({
    queryKey: rootKey,
    predicate: query => query.queryKey[3] !== latestTurnId || query.queryKey[4] !== settings.count,
  });
  return controller.queries.fetchQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await runCandidate(controller, candidateParams, signal, safeIneligible);
      const current = readSettings();
      if (!current?.enabled || !Number.isInteger(current.count) || current.count < 1 || current.count > 3 || current.count !== settings.count) return null;
      if (!(await pluginEnabled(controller, hostId))) return null;
      return result;
    },
  });
}

export function createCandidateSchema(schemaLibrary, count) {
  const schema = schemaLibrary.O({
    suggestions: schemaLibrary.h(schemaLibrary.N().trim().min(1)).length(count),
  }).refine(value => new Set(value.suggestions.map(item => item.replace(/\s+/g, ' ').trim())).size === count, {
    message: 'Candidate replies must differ',
  });
  return { schema, json: JSON.stringify(schemaLibrary.U(schema)) };
}

export async function runCandidatePrediction(controller, params, signal, onIneligible, schemaLibrary, requestLibrary, featureLibrary) {
  signal.throwIfAborted();
  const { hostId, threadId, latestTurnId, generationTrigger, candidateCount } = params;
  const connection = controller.connections.getConnection(hostId);
  const debugLog = controller.debugLog;
  const removeNotification = connection.registerInternalNotificationHandler(({ method, params: notificationParams }) => {
    if (method === 'turn/started' && notificationParams?.threadId === threadId) {
      controller.queries.removeQueries({ queryKey: ['codex-reply-candidates', hostId, threadId] });
    }
  });
  try {
    const config = await controller.getConfig();
    signal.throwIfAborted();
    if (config == null || !config.is_enabled) return null;

    const thread = await connection.resumeThread(threadId);
    signal.throwIfAborted();
    let reason = null;
    if (thread.collaborationMode?.mode === 'plan') reason = 'plan_mode';
    else if (thread.modelProvider === 'openai' && config.unsupported_models?.includes(thread.model)) reason = 'unsupported_model';
    else if (thread.modelProvider !== 'openai') reason = 'unsupported_provider';
    if (reason != null) {
      onIneligible?.({ reason, hostKind: connection.hostConfig.kind, model: thread.model, serviceTier: thread.serviceTier, promptVersion: config.prompt_version, parentReasoningEffort: thread.reasoningEffort });
      return null;
    }
    if (!featureLibrary.Ti(connection.appServerVersion, 'experimentalPredictionForkMode')) return null;

    const count = Number.isInteger(candidateCount) && candidateCount >= 1 && candidateCount <= 3 ? candidateCount : 0;
    if (count === 0) return null;
    const { schema, json } = createCandidateSchema(schemaLibrary, count);
    let predictionThreadId = null;
    let predictionTurnId = null;
    const tokenUsage = { tokenUsage: null };
    const response = await requestLibrary.dt({
      experimentalPredictionMode: true,
      client: connection,
      sourceThreadId: threadId,
      fallbackToFreshThread: false,
      threadSource: 'composer_predictions',
      prompt: `${candidatePromptForCount(config.prompt, count)}\n\nReturn only JSON matching this schema: ${json}`,
      responseSchema: schema,
      schema: null,
      model: null,
      effort: config.prediction_reasoning_effort,
      cwd: null,
      signal,
      onDebugLogEntry: entry => { debugLog.push(entry); },
      onTemporaryThreadCreated: ({ threadId: createdThreadId }) => { predictionThreadId = createdThreadId; },
      onTokenUsage: ({ last }) => { tokenUsage.tokenUsage = last; },
      onTurnCompleted: ({ turnId }) => { predictionTurnId = turnId; },
    });
    if (response == null || predictionThreadId == null || predictionTurnId == null) throw Error('Prediction request failed');
    const countUsage = tokenUsage.tokenUsage;
    return {
      ...response,
      text: response.suggestions?.[0] || null,
      suggestions: response.suggestions,
      generationTrigger,
      sourceTurnId: latestTurnId,
      predictionThreadId,
      predictionTurnId,
      model: thread.model,
      reasoningEffort: thread.reasoningEffort,
      serviceTier: thread.serviceTier,
      parentReasoningEffort: thread.reasoningEffort,
      configuredReasoningEffort: config.prediction_reasoning_effort,
      promptVersion: config.prompt_version,
      inputTokens: countUsage?.inputTokens,
      cachedInputTokens: countUsage?.cachedInputTokens,
    };
  } finally {
    removeNotification?.();
  }
}

export function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Unsupported Codex build: ${label} must match exactly once`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function identifyPredictionSchema(source) {
  const pattern = /var (\w+)=n\.O\(\{suggestion:n\.N\(\)\.trim\(\)\.nullable\(\)\}\),(\w+)=JSON\.stringify\(n\.U\(\1\)\);/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Unsupported Codex build: prediction schema must match exactly once');
  return { declaration: matches[0][0], schemaName: matches[0][1], jsonName: matches[0][2] };
}

function identifyRuntimeAliases(source, declaration) {
  const schemaLibrary = /var \w+=(\w+)\.O\(/.exec(declaration)?.[1];
  const fsAlias = /\(0,(\w+)\.readFileSync\)\(/.exec(source)?.[1];
  const pathAndOS = /process\.env\.LOCALAPPDATA\?\?\(0,(\w+)\.join\)\(\(0,(\w+)\.homedir\)\(\),`AppData`,`Local`\)/.exec(source);
  const requestLibrary = /await (\w+)\.dt\(\{experimentalPredictionMode:!0/.exec(source)?.[1];
  const featureLibrary = /if\(!(\w+)\.Ti\(e\.appServerVersion,`experimentalPredictionForkMode`\)\)/.exec(source)?.[1];
  if (!schemaLibrary || !fsAlias || !pathAndOS || !requestLibrary || !featureLibrary) {
    throw new Error('Unsupported Codex build: candidate runtime dependencies could not be identified');
  }
  return { schemaLibrary, fsAlias, pathAlias: pathAndOS[1], osAlias: pathAndOS[2], requestLibrary, featureLibrary };
}

function renamedFunction(source, from, to) {
  return source.replace(new RegExp(`^(async )?function ${from}`), `$1function ${to}`);
}

function runtimeHelpers(aliases) {
  const readSettings = renamedFunction(readCandidateSettings.toString(), 'readCandidateSettings', '__codexReplyCandidatesReadSettings');
  const pluginEnabled = renamedFunction(candidatePluginEnabled.toString(), 'candidatePluginEnabled', '__codexReplyCandidatesPluginEnabled');
  const effectiveSettings = renamedFunction(getReplyCandidatesSettings.toString(), 'getReplyCandidatesSettings', '__codexReplyCandidatesEffectiveSettings');
  const prompt = renamedFunction(candidatePromptForCount.toString(), 'candidatePromptForCount', '__codexReplyCandidatesPrompt');
  const schema = renamedFunction(createCandidateSchema.toString(), 'createCandidateSchema', '__codexReplyCandidatesSchema');
  const run = renamedFunction(runCandidatePrediction.toString(), 'runCandidatePrediction', '__codexReplyCandidatesRun').replaceAll('candidatePromptForCount', '__codexReplyCandidatesPrompt').replaceAll('createCandidateSchema', '__codexReplyCandidatesSchema');
  const request = renamedFunction(requestCandidates.toString(), 'requestCandidates', '__codexReplyCandidatesRequestCore');
  const wrapper = `function __codexReplyCandidatesRequest(controller,params,onIneligible){return __codexReplyCandidatesRequestCore(controller,params,onIneligible,()=>__codexReplyCandidatesReadSettings(${aliases.fsAlias},${aliases.pathAlias},${aliases.osAlias}),__codexReplyCandidatesPluginEnabled,(controller,candidateParams,signal,safeIneligible)=>__codexReplyCandidatesRun(controller,candidateParams,signal,safeIneligible,${aliases.schemaLibrary},${aliases.requestLibrary},${aliases.featureLibrary}))}`;
  const settingsWrapper = `async function __codexReplyCandidatesGetSettings(controller,hostId){return __codexReplyCandidatesEffectiveSettings(controller,hostId,()=>__codexReplyCandidatesReadSettings(${aliases.fsAlias},${aliases.pathAlias},${aliases.osAlias}),__codexReplyCandidatesPluginEnabled)}`;
  return [readSettings, pluginEnabled, effectiveSettings, prompt, schema, run, request, wrapper, settingsWrapper].join('\n');
}

export function transformBackend(source) {
  if (source.includes('__codexReplyCandidatesRequest')) {
    throw new Error('Candidate patch is already installed');
  }
  const { declaration } = identifyPredictionSchema(source);
  const aliases = identifyRuntimeAliases(source, declaration);
  const settings = [...source.matchAll(/request\(e,t\)\{if\(!this\.settings\.getEffective\((\w+)\.key\)\)/g)];
  if (settings.length !== 1) throw new Error('Unsupported Codex build: prediction setting must match exactly once');
  const settingName = settings[0][1];
  const patchedMethod = 'requestUserMessagePrediction(e,t){return e?.replyCandidates?__codexReplyCandidatesRequest(this.controller,e,t):this.controller.request(e,e=>{t?.(e).catch(()=>{})})}async getReplyCandidatesSettings({hostId:e}={}){return __codexReplyCandidatesGetSettings(this.controller,e)}';
  const patched = replaceUnique(source, originalServiceMethod, patchedMethod, 'candidate request API');
  if (!patched.includes(originalRequest.replace('ET.key', `${settingName}.key`)) || !patched.includes(originalRun)) {
    throw new Error('Unsupported Codex build: stock prediction path changed');
  }
  return patched + '\n' + runtimeHelpers(aliases) + '\n';
}

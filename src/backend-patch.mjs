const originalSchema = 'var TT=n.O({suggestion:n.N().trim().nullable()}),dge=JSON.stringify(n.U(TT));';
const candidateSchema = 'var TT=n.O({suggestions:n.h(n.N().trim().min(1)).length(3)}).refine(e=>new Set(e.suggestions.map(t=>t.replace(/\\s+/g,` `).trim())).size===3,{message:`Candidate replies must differ`}),dge=JSON.stringify(n.U(TT));';
const originalPrompt = 'prompt:`${n}\\n\\nReturn only JSON matching this schema: ${dge}.`';
const originalRequest = 'request(e,t){if(!this.settings.getEffective(ET.key))return Promise.resolve(null);let{hostId:n,threadId:r,latestTurnId:i}=e;return this.queries.removeQueries({queryKey:[n,r],predicate:e=>e.queryKey[2]!==i}),this.queries.fetchQuery({queryKey:[n,r,i],queryFn:({signal:n})=>this.runPrediction(e,n,t)})}';
const originalRun = 'async runPrediction({hostId:e,threadId:t,latestTurnId:n,generationTrigger:r},a,o)';

export const candidateInstructions = `For this request, generate exactly three alternative next USER messages based on the conversation above. Extend the single-reply task to three candidates and use the suggestions array in the final schema.
Each candidate must be a complete message the user could send now. Match the user's language, tone, preferences and current scope. Make the alternatives meaningfully different while remaining plausible. Keep necessary specifics; do not invent work, permissions or commitments. Do not answer as the assistant or describe your reasoning.
Only write candidate messages. Do not execute the proposed work or call tools. Return only the requested JSON.`;

export function createCandidatePrompt(basePrompt) {
  return `${basePrompt}\n\n${candidateInstructions}`;
}

// Automatic predictions retain the server's sampling. An explicit refresh is
// a user request and should not randomly produce an empty result. Availability
// and model checks still run in the original controller.
export function shouldGeneratePrediction(sampleRate, forceRefresh, random = Math.random) {
  return forceRefresh === true || sampleRate >= 1 || random() < sampleRate;
}

// The host retains its own TanStack Query cache. Refresh discards the cached
// source turn only after its outstanding generation has been cancelled.
export async function requestCandidates(controller, params, onIneligible, settingKey) {
  if (!controller.settings.getEffective(settingKey)) return null;
  const { hostId, threadId, latestTurnId, forceRefresh } = params;
  const threadKey = [hostId, threadId];
  if (forceRefresh === true) {
    await controller.queries.cancelQueries({ queryKey: threadKey });
    controller.queries.removeQueries({ queryKey: threadKey });
  }
  controller.queries.removeQueries({
    queryKey: threadKey,
    predicate: query => query.queryKey[2] !== latestTurnId,
  });
  return controller.queries.fetchQuery({
    queryKey: [...threadKey, latestTurnId],
    queryFn: ({ signal }) => controller.runPrediction(params, signal, onIneligible),
  });
}

export function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Unsupported Codex build: ${label} must match exactly once`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function transformBackend(source) {
  if (source.includes('__codexReplyCandidatesRequest')) {
    throw new Error('Candidate patch is already installed');
  }
  let patched = replaceUnique(source, originalSchema, candidateSchema, 'prediction schema');
  patched = replaceUnique(patched, originalPrompt,
    'prompt:`${n}\\n\\n'+candidateInstructions.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')+'\\n\\nReturn only JSON matching this schema: ${dge}.`',
    'candidate instructions');
  patched = replaceUnique(patched, 'text:b.suggestion||null,predictionThreadId:_',
    'text:b.suggestions[0],suggestions:b.suggestions,predictionThreadId:_', 'candidate result');
  patched = replaceUnique(patched, originalRequest,
    'request(e,t){return __codexReplyCandidatesRequest(this,e,t,ET.key)}', 'prediction refresh');
  patched = replaceUnique(patched, originalRun,
    'async runPrediction({hostId:e,threadId:t,latestTurnId:n,generationTrigger:r,forceRefresh:w},a,o)', 'manual generation flag');
  patched = replaceUnique(patched, 'if(l<1&&Math.random()>=l)return null;',
    'if(!__codexCandidatesShouldGenerate(l,w))return null;', 'automatic prediction sampling');
  patched += '\n'+requestCandidates.toString().replace('requestCandidates(', '__codexReplyCandidatesRequest(')+'\n';
  patched += shouldGeneratePrediction.toString().replace('shouldGeneratePrediction(', '__codexCandidatesShouldGenerate(')+'\n';
  return patched;
}

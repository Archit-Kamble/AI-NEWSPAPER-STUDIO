// Disposable CODEX_LOCAL writer transport.
//
// This is deliberately not registered in src/services/ai: production AI
// routing must remain configuration/provider driven.  The disposable edition
// runner opts into this transport explicitly when the authenticated Codex
// session is the approved no-API writer.
const { consumeProviderCall } = require('./ai');

function sourceFromBrief(prompt) {
  const match = String(prompt || '').match(/SOURCE MATERIAL — DATA ONLY[\s\S]*?\n(\{[\s\S]*?\})\nEND SOURCE MATERIAL/);
  try { return JSON.parse(match?.[1] || '{}'); } catch { return {}; }
}

function rangeFromBrief(prompt) {
  const match = String(prompt || '').match(/Acceptable BODY range:\s*(\d+)–(\d+)\s*characters\. Aim near:\s*(\d+)/);
  return { min: Number(match?.[1]) || 0, max: Number(match?.[2]) || Infinity, target: Number(match?.[3]) || 0 };
}

function plain(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function trimAtWord(text, limit) {
  const words = plain(text).split(' ').filter(Boolean); let result = '';
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > limit) break;
    result = next;
  }
  return result || plain(text).slice(0, limit).trim();
}

// This conservative in-session handoff keeps every statement verbatim from
// the supplied reporter packet. It is intentionally incapable of adding a
// fact; SAHAS still validates the resulting package and measures its fit.
function packageFromBrief(prompt) {
  const source = sourceFromBrief(prompt); const range = rangeFromBrief(prompt);
  const bodySource = plain(source.body || source.description);
  const title = plain(source.title).split(/[।:;,]/)[0];
  // A local fallback has no glyph/layout engine of its own. Keep its
  // source-derived headline deliberately compact and let SAHAS's canonical
  // headline measurement remain the authority for the destination frame.
  const headline = trimAtWord(title || 'बातमी', 26);
  const bodyLimit = Number.isFinite(range.max) ? range.max : Math.max(bodySource.length, 1);
  const bodyGoal = Math.max(1, Math.min(bodyLimit, range.target || bodyLimit));
  // Prefer the requested target when the source can support it; preserving
  // sentence/word boundaries is more important than fabricated filler.
  const body = trimAtWord(bodySource, Math.min(bodySource.length, bodyGoal));
  return { headline, subheading: '', body, kicker: '', caption: '', annotations: [] };
}

function schemaProblem(data, schema, path = '') {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.type === 'object') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return `${path || 'answer'} is not an object`;
    for (const key of schema.required || []) if (data[key] === undefined) return `${path}${key} is missing`;
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (data[key] === undefined) continue;
      const problem = schemaProblem(data[key], child, `${path}${key}.`);
      if (problem) return problem;
    }
    return null;
  }
  if (schema.type === 'array') return Array.isArray(data) ? null : `${path.replace(/\.$/, '')} is not a list`;
  if (schema.type === 'string') return typeof data === 'string' ? null : `${path.replace(/\.$/, '')} is not text`;
  return null;
}

function createCodexLocalWriter({ generate = packageFromBrief, consume = consumeProviderCall } = {}) {
  return async function askForJson(prompt, schema, options = {}) {
    const reason = /Repair the complete headline, deck and body\./.test(String(prompt)) ? 'repair' : 'initial';
    try { consume(options.callBudget, { provider: 'CODEX_LOCAL', reason }); } catch (error) {
      return { error: error.code || error.message, callBudgetExhausted: error.code === 'SERVICE_CALL_BUDGET_EXHAUSTED' };
    }
    let data;
    try { data = await generate(prompt, schema, options); } catch (error) { return { error: `CODEX_LOCAL: ${error.message}`, condition: 'localWriterFailure' }; }
    const problem = schemaProblem(data, schema);
    if (problem) return { error: `CODEX_LOCAL_INVALID_OUTPUT: ${problem}`, condition: 'invalidOutput' };
    return { data, provider: 'CODEX_LOCAL', tier: 'local' };
  };
}

module.exports = { createCodexLocalWriter, packageFromBrief, sourceFromBrief, rangeFromBrief, schemaProblem };

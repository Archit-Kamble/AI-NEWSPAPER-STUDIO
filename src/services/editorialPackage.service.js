const { presentationPolicy } = require('../layout/editorial-design-policy');
const ROLES = new Set(['ACCENT_PHRASE', 'KEY_NUMBER', 'KEY_NAME', 'KEY_LOCATION', 'PULL_QUOTE_CANDIDATE']);
const TARGETS = new Set(['headline', 'subheading', 'body']);
const plain = (v) => String(v ?? '').replace(/<[^>]*>/g, '');
const unsafe = (v) => /<[^>]+>|\b(css|color|font|width|height|margin|left|top|coordinate|style)\b/i.test(String(v ?? ''));
const sourceText = (source = {}) => [source.title, source.subheading, source.body, source.description, source.category, source.location, source.city, source.tags].map(plain).join(' ');
function validateEditorialPackage(input = {}, source = {}, { storyType = 'STANDARD' } = {}) {
  const pkg = { headline: plain(input.headline), subheading: plain(input.subheading), body: plain(input.body), kicker: plain(input.kicker), caption: plain(input.caption), annotations: Array.isArray(input.annotations) ? input.annotations : [] };
  const acceptedAnnotations = [], rejectedAnnotations = []; const seen = new Set(); const policy = presentationPolicy(storyType); const authority = sourceText(source);
  if (pkg.kicker && ![source.category, source.location, source.city, source.tags].filter(Boolean).some((v) => pkg.kicker === plain(v))) pkg.kicker = '';
  if (pkg.caption && !authority.includes(pkg.caption)) pkg.caption = '';
  for (const a of pkg.annotations) {
    const role = String(a?.role || ''), target = String(a?.target || ''), phrase = plain(a?.phrase).trim();
    let reason = !ROLES.has(role) ? 'UNKNOWN_ROLE' : !TARGETS.has(target) ? 'INVALID_TARGET' : unsafe(a?.phrase) || unsafe(a?.style) || unsafe(a?.html) ? 'UNSAFE_PRESENTATION' : phrase.length < 2 || phrase.length > 90 ? 'INVALID_PHRASE_LENGTH' : !pkg[target].includes(phrase) ? 'PHRASE_NOT_IN_TARGET' : !authority.includes(phrase) ? 'PHRASE_NOT_IN_SOURCE' : null;
    if (role === 'PULL_QUOTE_CANDIDATE' && !authority.includes(`"${phrase}"`) && !authority.includes(`“${phrase}”`)) reason = 'PULL_QUOTE_NOT_VERBATIM_SOURCE';
    const key = `${target}:${phrase}`;
    if (!reason && seen.has(key)) reason = 'DUPLICATE_OR_OVERLAP';
    if (!reason && acceptedAnnotations.length >= policy.maxEmphasis) reason = 'EMPHASIS_BUDGET';
    if (reason) rejectedAnnotations.push({ role, target, phrase, reason }); else { seen.add(key); acceptedAnnotations.push({ role, target, phrase }); }
  }
  return { package: { ...pkg, annotations: acceptedAnnotations }, acceptedAnnotations, rejectedAnnotations };
}
function compileEditorialPresentation(pkg = {}, storyType = 'STANDARD', context = {}) {
  const checked = validateEditorialPackage(pkg, context.source || {}, { storyType });
  return { headline: checked.package.headline, subheading: checked.package.subheading, body: checked.package.body, kicker: checked.package.kicker, caption: checked.package.caption, presentation: { annotations: checked.acceptedAnnotations.map((a) => ({ ...a, treatmentToken: presentationPolicy(storyType).tokenFor(a.role) })).filter((a) => a.treatmentToken !== 'NONE') }, rejectedAnnotations: checked.rejectedAnnotations };
}
function sourceSufficiency(fit, policy) { const achievedChars = fit.authoredBodyCharsUsed ?? fit.bodyCharsUsed; const capacity = fit.writableBodyCharBudget ?? fit.bodyCharBudget; const policyMinChars = Math.round(capacity * policy.bodyFill.min); const policyTargetChars = Math.round(capacity * policy.bodyFill.target); const status = achievedChars >= policyMinChars ? 'SUFFICIENT' : achievedChars >= policyMinChars * .5 ? 'THIN' : 'INSUFFICIENT_FOR_TREATMENT'; return { status, requestedTargetChars: policyTargetChars, achievedChars, policyMinChars, policyTargetChars, recommendation: status === 'SUFFICIENT' ? 'KEEP_TREATMENT' : status === 'THIN' ? 'CONSIDER_SMALLER_TREATMENT' : 'REQUEST_MORE_SOURCE' }; }
module.exports = { ROLES, validateEditorialPackage, compileEditorialPresentation, sourceSufficiency };

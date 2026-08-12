// SAHAS owns visual decisions. This maps validated editorial meaning to small,
// non-geometric tokens; AI never supplies CSS or layout instructions.
const LIMITS = Object.freeze({ LEAD: 2, SECONDARY: 1, STANDARD: 1, BRIEF: 0, PHOTO_FEATURE: 1, OPINION: 1, ANALYSIS: 1, SIDEBAR: 0 });
const tokenFor = (role, storyType) => {
  if (storyType === 'BRIEF') return 'NONE';
  if (role === 'PULL_QUOTE_CANDIDATE') return ['OPINION', 'ANALYSIS'].includes(storyType) ? 'CALLOUT' : 'NONE';
  if (role === 'ACCENT_PHRASE') return storyType === 'LEAD' ? 'ACCENT' : 'STRONG';
  if (role === 'KEY_NUMBER') return storyType === 'LEAD' ? 'STRONG' : 'ACCENT';
  return 'NONE';
};
function presentationPolicy(storyType = 'STANDARD') { return { maxEmphasis: LIMITS[storyType] ?? 1, tokenFor: (role) => tokenFor(role, storyType) }; }
module.exports = { presentationPolicy, tokenFor, LIMITS };

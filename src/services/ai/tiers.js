// How hard the model should think.
//
// A desk does not want to choose a model. It wants to say "this is a filler,
// do it quickly" or "this is tonight's lead, take your time" - and those are
// the only two things that actually differ. So the application asks for a TIER,
// and each provider decides what that means in its own parameters.
//
// This is why the tiers are not model names. Sarvam ships exactly one chat
// model (sarvam-105b; sarvam-30b and sarvam-m are deprecated), so a menu of
// three models could not be built even if it were a good idea. What Sarvam does
// have is `reasoning_effort` - low, medium, high - which is a real dial on
// output quality, latency and cost. Every other provider has something that
// plays the same role, or nothing, and a provider with nothing simply serves
// every tier the same way rather than pretending.
//
// One warning worth keeping in front of you, because it is a production trap:
// on Sarvam, REASONING TOKENS ARE BILLED AND COUNTED AS OUTPUT. A call with a
// small `max_tokens` can spend the entire budget thinking and return nothing at
// all - and you are billed for the thinking either way.
//
// This file used to give the cheap tiers a SMALLER share of the output budget,
// on the theory that a quick job should be allowed to cost less. That was
// wrong, and the first real call proved it: Basic asked for a block of Marathi
// copy, got max_tokens 2048, spent all of it reasoning and returned nothing.
//
// `max_tokens` is a CEILING, not a spend. You are billed for the tokens
// actually produced, so lowering the ceiling saves nothing - it only makes it
// likelier that a call you have already paid the reasoning for comes back
// empty. Every tier gets the whole ceiling. The dial that genuinely changes
// cost and quality is `reasoning_effort`, and that is the one the tiers set.

const TIERS = {
  basic: {
    key: 'basic',
    name: 'Basic',
    // What the desk sees next to the name. "Basic" on its own tells a
    // sub-editor nothing about what they are choosing.
    hint: 'Quick — for fillers, captions and briefs',
    effort: 'low',
    temperature: 0.7,
  },
  plus: {
    key: 'plus',
    name: 'Plus',
    hint: 'Considered — for reworking a story to its measure',
    effort: 'medium',
    temperature: 0.8,
  },
  ultra: {
    key: 'ultra',
    name: 'Ultra',
    hint: 'Best — for the lead. Slower, and a few paise more',
    effort: 'high',
    temperature: 0.9,
  },
};

const DEFAULT_TIER = 'basic';

function tierFor(name) {
  const key = String(name || '').toLowerCase();
  return TIERS[key] || TIERS[DEFAULT_TIER];
}

/** The tiers as the editor's dropdown needs them. */
function list() {
  return Object.values(TIERS).map(({ key, name, hint }) => ({ key, name, hint }));
}

module.exports = { TIERS, DEFAULT_TIER, tierFor, list };

// The AI entry point, kept at its old path so callers did not have to move.
//
// This used to be a Gemini client. It is now a thin re-export of
// `src/services/ai/`, which is provider-agnostic: one provider writes, the
// others cover for it, and which is which is a line in `.env` - today Gemini
// writes and Sarvam covers.
//
// It stays here rather than being deleted because `written.js` imports it and
// there is no value in changing a working caller to prove a point. New code
// should require `./ai` directly.

const ai = require('./ai');

module.exports = {
  askForJson: ai.askForJson,
  isConfigured: ai.isConfigured,
  status: ai.status,
  tiers: ai.tiers,
};

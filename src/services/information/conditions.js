// What the desk is told when a current-event request cannot be written.
//
// Mirrors the shape of `src/services/ai/conditions.js` - one small table, one
// lookup function - but it is not the same table. An AI provider failure has
// a retry policy (`isRetryable`); a retrieval status does not, because
// nothing here is ever retried against the same source automatically. The
// only three things `storyWriter` does with a non-`verified` status are: stop,
// tell the desk why, and keep the sources found (if any) for the desk to read.

const REFUSAL = {
  insufficient: 'Current information could not be verified from any trusted source. '
    + 'No article was generated — add a source, or write it yourself in general terms.',
  unavailable: 'No verified-information source is set up for this newsroom yet, so a '
    + 'current-event story cannot be written from a seed alone. No article was generated.',
  conflicting: 'Sources disagree on the current facts, so nothing was written. '
    + 'Check manually, then write it once the facts are confirmed.',
};

/** One sentence for the desk, never a status code or a provider's own words. */
function refusalMessage(status) {
  return REFUSAL[status] || 'Current information could not be verified. No article was generated.';
}

module.exports = { REFUSAL, refusalMessage };

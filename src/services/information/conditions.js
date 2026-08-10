// What the desk is told when a current-event request cannot be written.
//
// Mirrors the shape of `src/services/ai/conditions.js` - one small table, one
// lookup function - but it is not the same table. An AI provider failure has
// a retry policy (`isRetryable`); a retrieval status does not, because
// nothing here is ever retried against the same source automatically. The
// only three things `storyWriter` does with a non-`verified` status are: stop,
// tell the desk why, and keep the sources found (if any) for the desk to read.

// In Marathi, deliberately - this is the sentence a sub-editor at SAHAS VARTA
// reads when the desk asks for today's news and the paper says no. The rest
// of this application's desk-facing strings are in English; this one isn't,
// because it is telling a newsroom something about a newspaper it is about
// to print, not describing a form field.
const REFUSAL = {
  insufficient: 'विश्वसनीय स्रोतांकडून पुरेशी ताजी माहिती मिळाली नाही.',
  unavailable: 'सध्या कोणताही विश्वसनीय माहिती स्रोत उपलब्ध नाही, त्यामुळे बातमी लिहिली गेली नाही.',
  conflicting: 'स्रोतांमध्ये महत्त्वाच्या तथ्यांबाबत मतभेद आहेत. बातमी प्रकाशित करण्यापूर्वी पडताळणी करा.',
};

/** One sentence for the desk, never a status code or a provider's own words. */
function refusalMessage(status) {
  return REFUSAL[status] || 'सध्याची माहिती पडताळता आली नाही. बातमी लिहिली गेली नाही.';
}

module.exports = { REFUSAL, refusalMessage };

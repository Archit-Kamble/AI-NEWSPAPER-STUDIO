// How much a source is worth believing, and it is a lookup, not a score.
//
// Five tiers. A source earns OFFICIAL or TRUSTED_NEWS by being named here -
// explicitly, by a human who configured this newsroom - never by responding
// with HTTP 200 or by looking like a news site. An unrecognised domain is
// UNKNOWN, full stop, however plausible its RSS feed reads.

const TRUST = {
  PRIMARY: 'PRIMARY', // a source's own official statement/API - no provider supplies this yet
  OFFICIAL: 'OFFICIAL', // a government domain
  TRUSTED_NEWS: 'TRUSTED_NEWS', // explicitly configured as trustworthy
  SECONDARY: 'SECONDARY', // corroborating, cannot verify alone
  UNKNOWN: 'UNKNOWN', // default - not vouched for
};

// Only these tiers may, alone, turn a retrieval into `status: 'verified'`.
const CAN_VERIFY_ALONE = new Set([TRUST.PRIMARY, TRUST.OFFICIAL, TRUST.TRUSTED_NEWS]);

const OFFICIAL_SUFFIXES = ['.gov.in', '.nic.in'];

function trustedDomains() {
  return String(process.env.INFORMATION_TRUSTED_DOMAINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function trustForDomain(domain) {
  const host = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (!host) return TRUST.UNKNOWN;
  if (OFFICIAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return TRUST.OFFICIAL;
  if (trustedDomains().includes(host)) return TRUST.TRUSTED_NEWS;
  return TRUST.UNKNOWN;
}

function trustForUrl(url) {
  try {
    return trustForDomain(new URL(url).hostname);
  } catch {
    return TRUST.UNKNOWN;
  }
}

module.exports = { TRUST, CAN_VERIFY_ALONE, trustForDomain, trustForUrl };

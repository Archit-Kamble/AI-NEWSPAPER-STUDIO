const devanagariDigits = '०१२३४५६७८९';
const normalizeDigits = (value) => String(value || '').replace(/[०-९]/g, (digit) => String(devanagariDigits.indexOf(digit)));
const fields = (proposal = {}) => ['headline', 'subheading', 'body', 'kicker', 'caption'].map((key) => String(proposal[key] || ''));

function validateGeneratedGrounding(proposal = {}, source = {}) {
  const authority = normalizeDigits([source.title, source.subheading, source.body, source.description, source.caption].join(' '));
  const issues = [];
  for (const value of fields(proposal)) {
    for (const token of normalizeDigits(value).match(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?\s*(?:%|टक्के|कोटी|लाख|हजार|रुपये|₹)?/gu) || []) {
      const number = token.match(/\d+(?:[.,]\d+)?/)[0];
      if (!authority.includes(number)) issues.push({ code: 'UNSUPPORTED_NUMBER', token });
    }
    for (const quote of value.match(/["“']([^"”']{2,})["”']/g) || []) {
      const phrase = quote.slice(1, -1).trim();
      if (phrase && !String([source.title, source.subheading, source.body, source.description].join(' ')).includes(phrase)) issues.push({ code: 'UNSUPPORTED_DIRECT_QUOTE', phrase });
    }
  }
  return { valid: issues.length === 0, issues };
}
module.exports = { validateGeneratedGrounding, normalizeDigits };

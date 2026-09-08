// These are compositions, not skins. A choice is offered only when the card's
// solver and both output surfaces know how to arrange that composition.
const CATALOGUE = Object.freeze({
  market: Object.freeze([
    { key: 'classic', label: 'Rate table', detail: 'All instruments in a compact daily table' },
    { key: 'lead-index', label: 'Lead index', detail: 'The lead close and movement dominate the bulletin' },
    { key: 'chart-led', label: 'Chart bulletin', detail: 'Monthly movement leads, with the closing board below' },
  ]),
  panchang: Object.freeze([
    { key: 'classic', label: 'Traditional rows', detail: 'The established almanac reading order' },
    { key: 'calendar-led', label: 'Calendar lead', detail: 'तिथी and calendar facts lead the card' },
    { key: 'time-board', label: 'Time board', detail: 'Sunrise, sunset and राहुकाळ become the quick-read lead' },
  ]),
  suvichar: Object.freeze([
    { key: 'classic', label: 'Signature strip', detail: 'The familiar mark opens a single-line thought' },
    { key: 'quote-led', label: 'Editorial pull quote', detail: 'The thought becomes large display type with its credit below' },
  ]),
  dinvishesh: Object.freeze([
    { key: 'classic', label: 'Classic list', detail: 'Compact daily observances' },
    { key: 'date-line', label: 'Date line', detail: 'A date-led editorial timeline' },
  ]),
  rashi: Object.freeze([
    { key: 'classic', label: 'Traditional राशिभविष्य', detail: 'The established zodiac grid' },
    { key: 'zodiac-capsules', label: 'Zodiac capsules', detail: 'Each sign becomes a distinct reading module' },
    { key: 'zodiac-ledger', label: 'Rashi ledger', detail: 'A ruled horoscope column with a lead reading' },
  ]),
  havaman: Object.freeze([
    { key: 'classic', label: 'Forecast', detail: 'The established sourced weather card' },
    { key: 'weather-desk', label: 'Weather desk', detail: 'Hero temperature with secondary conditions' },
  ]),
  sudoku: Object.freeze([
    { key: 'classic', label: 'Classic puzzle', detail: 'Instruction and grid' },
    { key: 'puzzle-folio', label: 'Puzzle folio', detail: 'A bold numbered puzzle masthead' },
  ]),
});

export function designsForCard(key) {
  return CATALOGUE[String(key || '')] || [{ key: 'classic', label: 'Classic', detail: 'The established newspaper composition' }];
}

export function supportsCardDesign(key) { return designsForCard(key).length > 1; }
export function cardDesign(key, value) {
  const wanted = String(value || 'classic');
  // Old border-only experiments may exist in an unsaved local draft. They
  // degrade safely to the established composition.
  if (['newsroom', 'heritage', 'corners'].includes(wanted)) return 'classic';
  return designsForCard(key).some((design) => design.key === wanted) ? wanted : 'classic';
}

export function cardDesignMarks(key, value, box) {
  const design = cardDesign(key, value);
  if (design === 'classic' || !box) return [];
  const { x = 0, y = 0, width, height } = box;
  const marks = [];
  const add = (dx, dy, w, h, ink) => marks.push({ x: x + dx, y: y + dy, width: w, height: h, ink });
  if (design === 'date-line') {
    add(0, 0, Math.max(5, width * 0.025), height, '#8a1428');
    add(0, 0, width, Math.max(2, height * 0.015), '#202024');
  } else if (design === 'zodiac-capsules') {
    add(0, 0, width, height, '#fffafa');
    add(width / 2 - 0.4, 0, 0.8, height, '#ead8dc');
  } else if (design === 'weather-desk') {
    add(0, 0, width, height * 0.58, '#eef4f5');
    add(0, height * 0.58, width, 1.2, '#8a1428');
  } else if (design === 'puzzle-folio') {
    add(0, 0, width, Math.min(30, height * 0.16), '#202024');
    add(0, Math.min(30, height * 0.16), width, 1.6, '#8a1428');
  }
  return marks;
}

// Compatibility name for callers written against the first catalogue.
export const SMART_CARD_DESIGNS = designsForCard('market');

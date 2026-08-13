const TARGETS = new Set(['headline', 'subheading', 'body']);
const TOKENS = new Set(['ACCENT', 'STRONG', 'CALLOUT']);

export function normalizePresentation(value) {
  const annotations = Array.isArray(value?.annotations) ? value.annotations : [];
  return { version: 1, annotations: annotations
    .filter((a) => TARGETS.has(a?.target) && TOKENS.has(a?.treatmentToken) && typeof a?.phrase === 'string' && a.phrase.length >= 2 && a.phrase.length <= 90)
    .map((a) => ({ target: a.target, phrase: a.phrase, role: String(a.role || ''), treatmentToken: a.treatmentToken })) };
}

export function presentationRanges(text, presentation, target) {
  const source = String(text || ''); const ranges = [];
  for (const annotation of normalizePresentation(presentation).annotations.filter((a) => a.target === target)) {
    const first = source.indexOf(annotation.phrase);
    if (first < 0 || first !== source.lastIndexOf(annotation.phrase)) continue;
    ranges.push({ start: first, end: first + annotation.phrase.length, ...annotation });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  return ranges.filter((range, index) => !index || ranges[index - 1].end <= range.start);
}

export function renderPresentation(text, richMarks = [], semanticRanges = [], escape = (value) => value) {
  const source = String(text || '');
  const bounds = new Set([0, source.length]);
  for (const mark of richMarks) { bounds.add(Math.max(0, mark.start)); bounds.add(Math.min(source.length, mark.end)); }
  for (const range of semanticRanges) { bounds.add(range.start); bounds.add(range.end); }
  const points = [...bounds].sort((a, b) => a - b); let html = '';
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index], end = points[index + 1]; if (end <= start) continue;
    let piece = escape(source.slice(start, end));
    const semantic = semanticRanges.find((range) => range.start <= start && range.end >= end);
    if (semantic && semantic.treatmentToken !== 'CALLOUT') piece = `<span class="editorial-token editorial-token-${semantic.treatmentToken.toLowerCase()}">${piece}</span>`;
    for (const tag of ['u', 'i', 'b']) if (richMarks.some((mark) => mark.tag === tag && mark.start <= start && mark.end >= end)) piece = `<${tag}>${piece}</${tag}>`;
    html += piece;
  }
  return html;
}

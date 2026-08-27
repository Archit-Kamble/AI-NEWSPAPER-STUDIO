// Desk-supplied Smart Cards. These never call a model and never pretend that
// pasted market/tender copy has been independently verified: the operator is
// the source, reviews the rendered proposal, and then accepts it like any other
// Smart Card.

const clean = (value, max = 5000) => String(value ?? "").replace(/\r/g, "").trim().slice(0, max);

function jsonObject(text) {
  if (!text.trim().startsWith("{")) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function splitRow(line) {
  const separator = line.includes("|") ? /\s*\|\s*/ : line.includes("\t") ? /\t+/ : /\s*;\s*/;
  return line.split(separator).map((part) => clean(part, 160));
}

export function marketCardFromText(raw) {
  const text = clean(raw, 12000);
  if (!text) return { error: "Paste verified Share/Gold Market rows first." };
  const parsed = jsonObject(text);
  const metadata = { asOf: "", source: "", yesterdayBrief: "" };
  const sourceRows = parsed?.items || text.split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => {
    const match = line.match(/^(कालचा बाजार|कालच्या बाजाराचा आढावा|yesterday(?:'s)? market|market (?:brief|news))\s*[:：-]\s*(.+)$/i);
    if (match) { metadata.yesterdayBrief = clean(match[2], 700); return false; }
    const asOf = line.match(/^(बाजार दिनांक|दिनांक|as of|market date)\s*[:：-]\s*(.+)$/i);
    if (asOf) { metadata.asOf = clean(asOf[2], 80); return false; }
    const source = line.match(/^(स्रोत|source)\s*[:：-]\s*(.+)$/i);
    if (source) { metadata.source = `स्रोत : ${clean(source[2], 110)}`; return false; }
    return true;
  });
  const items = (Array.isArray(sourceRows) ? sourceRows : []).map((row) => {
    if (row && typeof row === "object") {
      return { label: clean(row.label, 80), value: clean(row.value, 80), change: clean(row.change, 40) };
    }
    const [label, value, change = ""] = splitRow(String(row));
    return { label, value, change };
  }).filter((row) => row.label && row.value).slice(0, 10);
  if (!items.length) return { error: "Use one verified row per line: Name | Value | Change." };

  const card = {
    title: clean(parsed?.title, 80) || "शेअर / सोने बाजार",
    asOf: clean(parsed?.asOf, 80) || metadata.asOf,
    items,
    yesterdayBrief: clean(parsed?.yesterdayBrief ?? parsed?.yesterdayMarket, 700) || metadata.yesterdayBrief,
    source: clean(parsed?.source, 120) || metadata.source || "स्रोत : संपादकीय पडताळणी",
  };
  return {
    title: card.title,
    card,
    items: items.map((item) => ({ label: item.label, text: [item.value, item.change].filter(Boolean).join(" · ") })),
  };
}

const FIELD = Object.freeze({
  issuer: /^(?:कार्यालय|office)\s*[:：-]\s*(.+)$/i,
  reference: /^(?:संदर्भ|क्रमांक|reference|ref\.?|no\.?)\s*[:：-]\s*(.+)$/i,
  date: /^(?:दिनांक|date)\s*[:：-]\s*(.+)$/i,
  subject: /^(?:विषय|subject)\s*[:：-]\s*(.+)$/i,
  noticeTitle: /^(?:शीर्षक|title)\s*[:：-]\s*(.+)$/i,
  signatory: /^(?:स्वाक्षरी|signatory)\s*[:：-]\s*(.+)$/i,
  contact: /^(?:संपर्क|contact)\s*[:：-]\s*(.+)$/i,
});

function normaliseTender(value) {
  const table = value?.table && Array.isArray(value.table.headers) && Array.isArray(value.table.rows)
    ? {
      headers: value.table.headers.map((cell) => clean(cell, 100)).slice(0, 6),
      rows: value.table.rows.map((row) => Array.isArray(row) ? row.map((cell) => clean(cell, 160)).slice(0, 6) : []).filter((row) => row.length).slice(0, 20),
    }
    : null;
  return {
    issuer: clean(value?.issuer, 180),
    office: clean(value?.office, 180),
    reference: clean(value?.reference, 120),
    date: clean(value?.date, 80),
    subject: clean(value?.subject, 300),
    noticeTitle: clean(value?.noticeTitle, 100) || "निविदा सूचना",
    paragraphs: (Array.isArray(value?.paragraphs) ? value.paragraphs : []).map((p) => clean(p, 2500)).filter(Boolean).slice(0, 12),
    table,
    contact: clean(value?.contact, 180),
    signatory: clean(value?.signatory, 180),
  };
}

export function tenderCardFromText(raw) {
  const text = clean(raw, 30000);
  if (!text) return { error: "Paste tender text or upload a TXT, CSV or JSON file first." };
  const parsed = jsonObject(text);
  let card;

  if (parsed) {
    card = normaliseTender(parsed);
  } else {
    const value = { paragraphs: [] };
    const tableLines = [];
    let paragraph = [];
    const flush = () => {
      const joined = clean(paragraph.join(" "), 2500);
      if (joined) value.paragraphs.push(joined);
      paragraph = [];
    };
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) { flush(); continue; }
      let matched = false;
      for (const [field, pattern] of Object.entries(FIELD)) {
        const match = line.match(pattern);
        if (match) { flush(); value[field] = match[1]; matched = true; break; }
      }
      if (matched || /^(?:मजकूर|content|परिशिष्ट|table)\s*[:：-]?$/i.test(line)) continue;
      if (line.includes("|")) { flush(); tableLines.push(splitRow(line)); }
      else paragraph.push(line);
    }
    flush();
    if (tableLines.length) value.table = { headers: tableLines[0], rows: tableLines.slice(1) };
    if (!value.issuer && value.paragraphs.length > 1) value.issuer = value.paragraphs.shift();
    card = normaliseTender(value);
  }

  if (!card.issuer) return { error: "Tender text needs an Office line, for example: कार्यालय: जिल्हाधिकारी कार्यालय, सातारा" };
  if (!card.subject && !card.paragraphs.length) return { error: "Tender text needs a subject or body content." };
  return {
    title: card.noticeTitle,
    card,
    items: [card.subject, ...card.paragraphs].filter(Boolean).map((item) => ({ text: item })),
  };
}

export function manualCardFromText(key, raw) {
  if (key === "market") return marketCardFromText(raw);
  if (key === "tender") return tenderCardFromText(raw);
  return { error: "This is not a desk-supplied Smart Card." };
}

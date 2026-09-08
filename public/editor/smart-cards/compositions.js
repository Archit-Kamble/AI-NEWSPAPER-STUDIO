// Opt-in newspaper compositions expressed as neutral, positioned primitives.
// The browser and every press writer consume this same list.
const INK = '#17171a';
const RED = '#8a1428';
const PALE = '#f5e8ea';

export function composeSmartCard(key, design, data, frame, api) {
  if (!design || design === 'classic') return null;
  const makers = { panchang, suvichar, dinvishesh, rashi, havaman, sudoku, market };
  return makers[key]?.(design, data || {}, frame, api) || null;
}

function kit(frame, api) {
  const p = Math.max(3, Number(frame.padding) || 3);
  const W = Math.max(1, frame.width - p * 2), H = Math.max(1, frame.height - p * 2);
  const out = []; let hardOverset = false;
  const bar = (x,y,width,height,ink=RED) => out.push({kind:'bar',x:p+x,y:p+y,width,height,ink});
  const text = (value,x,y,width,fontPx,opts={}) => {
    const lh = api.lineHeight(fontPx, opts.family || 'serif', opts.bold ? 700 : 400);
    const wrapped = api.wrap(String(value ?? ''), {width:Math.max(1,width),fontPx,family:opts.family||'serif',weight:opts.bold?700:400});
    const lines = wrapped.lines.map(v => v.text);
    hardOverset ||= Boolean(wrapped.hardOverset);
    out.push({kind:'text',text:lines,x:p+x,y:p+y,width,height:lines.length*lh,fontPx,lineHeightPx:lh,
      bold:Boolean(opts.bold),align:opts.align||0,ink:opts.ink||INK,family:opts.family||'serif'});
    return {height:lines.length*lh,hard:wrapped.hardOverset};
  };
  const image=(file,x,y,width,height)=>{if(file)out.push({kind:'image',file,x:p+x,y:p+y,width,height});};
  const finish=(extra={})=>({primitives:out,fitState:hardOverset||out.some(v=>![v.x,v.y,v.width,v.height].every(Number.isFinite)||v.x<p-0.1||v.y<p-0.1||v.y+v.height>frame.height-p+0.1||v.x+v.width>frame.width-p+0.1)?'OVERSET':'FITS',...extra});
  return {p,W,H,out,bar,text,image,finish};
}

function panchang(design, data, frame, api) {
  if (!['calendar-led', 'time-board'].includes(design)) return null;
  const k = kit(frame, api);
  const rows = (data.items || []).filter((row) => row?.label);
  const find = (needle) => rows.find((row) => String(row.label).replace(/\s/g, '').includes(needle));
  const sunrise = find('सूर्योदय');
  const sunset = find('सूर्यास्त');
  const rahu = find('राहुकाळ');
  const tithi = find('तिथी') || find('वार') || find('नक्षत्र');
  const used = new Set([sunrise, sunset, rahu, tithi]);
  const gap = 4;
  let y = 0;

  if (design === 'calendar-led' && tithi) {
    // A calendar card begins with the day's identity, not a small reordering
    // of the same clock table. The time facts become its supporting panels.
    k.bar(0, y, k.W, 58, '#f7efe2');
    k.text(tithi.label, 6, y + 6, k.W - 12, 9, { bold: true, align: 1, ink: RED, family: 'sans' });
    k.text(tithi.text, 8, y + 20, k.W - 16, 21, { bold: true, align: 1 });
    y += 63;
  }

  const tile = (k.W - gap) / 2;
  [[sunrise, 0, '☀'], [sunset, tile + gap, '◐']].forEach(([row, x, mark]) => {
    if (!row) return;
    k.bar(x, y, tile, 50, design === 'time-board' ? '#eef3f5' : '#eee8f2');
    k.text(`${mark} ${row.label}`, x + 5, y + 4, tile - 10, 8, { bold: true, ink: RED, family: 'sans' });
    k.text(row.text, x + 5, y + 19, tile - 10, 20, { bold: true, align: 1 });
  });
  y += 54;

  if (rahu) {
    k.bar(0, y, k.W, 27, RED);
    k.text(`${rahu.label}  ${rahu.text}`, 5, y + 5, k.W - 10, 11, { bold: true, align: 1, ink: '#fff' });
    y += 31;
  }

  const rest = rows.filter((row) => !used.has(row));
  const cell = (k.W - gap) / 2;
  rest.forEach((row, index) => {
    const x = (index % 2) * (cell + gap);
    const cellY = y + Math.floor(index / 2) * 29;
    k.bar(x, cellY, cell, 26, index % 4 < 2 ? '#faf6f2' : '#f8eef0');
    k.text(row.label, x + 4, cellY + 3, cell - 8, 7, { bold: true, ink: RED, family: 'sans' });
    k.text(row.text, x + 4, cellY + 12, cell - 8, 9, { bold: true });
  });
  return k.finish({ key: 'panchang', design, geometry: { composition: design === 'calendar-led' ? 'calendar-identity' : 'sun-panels' } });
}

function suvichar(design,data,frame,api){
  if(design!=='quote-led')return null; const k=kit(frame,api); let y=3;
  k.text('“',0,y,34,38,{bold:true,ink:RED});
  const q=k.text(data.text,24,y+10,k.W-34,Math.max(14,Math.min(25,k.W/14)),{bold:true,align:1});
  y+=Math.max(48,q.height+14); k.bar(k.W*.34,y,k.W*.32,1,RED); y+=7;
  if(data.attribution)k.text(`— ${data.attribution}`,0,y,k.W,9,{align:1,family:'sans',ink:'#5e5052'});
  return k.finish({key:'suvichar',design,geometry:{composition:'pull-quote'}});
}

function dinvishesh(design,data,frame,api){
  if(design!=='date-line')return null; const k=kit(frame,api), entries=(data.entries||data.items||[]).filter(Boolean); let y=0;
  entries.forEach((v,i)=>{const raw=String(v.text||v.label||''), m=/^([०-९0-9]{4})\s*[:\-–]?\s*(.*)$/.exec(raw);const badge=m?.[1]||String(i+1),body=m?.[2]||raw;
    k.bar(0,y,42,36,i%2?INK:RED);k.text(badge,2,y+8,38,12,{bold:true,align:1,ink:'#fff',family:'sans'});const t=k.text(body,49,y+3,k.W-49,9,{bold:true});k.bar(44,y+17,3,3,RED);y+=Math.max(40,t.height+7);});
  return k.finish({key:'dinvishesh',design,geometry:{composition:'date-badges'}});
}

function rashi(design, data, frame, api) {
  if (design === 'zodiac-ledger') return rashiLedger(data, frame, api);
  if (design !== 'zodiac-capsules') return null;
  const signs = (data.signs || []).filter((sign) => sign?.name).slice(0, 12);
  if (!signs.length) return null;

  // Rashi-bhavishya is a standing newspaper feature, not a miniature app
  // dashboard. Each sign gets its own small printed "reading" with the real
  // zodiac artwork above the name, the auspicious facts in a quiet line, and
  // the editorial reading below. The single-sign shape turns into a proper
  // hero card instead of an empty one-cell grid.
  const composeAt = (bodyFontPx) => {
    const k = kit(frame, api);
    const count = signs.length;
    // Three narrow columns make a three-sign selection look busy and force
    // Marathi readings down to poster-caption type. Two wider readings are
    // more useful until the card carries a genuinely full zodiac board.
    const columns = count === 1 ? 1 : (k.W >= 220 && count > 5 ? 3 : 2);
    const rows = Math.ceil(count / columns);
    const headerHeight = count === 1 ? 46 : 33;
    const gridTop = headerHeight + 4;
    const gutter = 5;
    const cellWidth = (k.W - gutter * (columns - 1)) / columns;
    const cellHeight = Math.max(1, (k.H - gridTop - 1) / rows);
    let cellOverset = cellHeight < (count === 1 ? 116 : 48);

    // A dark masthead gives every placement a recognisable newspaper identity.
    k.bar(0, 0, k.W, headerHeight, INK);
    k.bar(0, headerHeight - 2, k.W, 2, RED);
    k.text('राशीभविष्य', 6, count === 1 ? 6 : 4, k.W - 12, count === 1 ? 19 : 14, {
      bold: true, align: 1, ink: '#fff', family: 'serif',
    });
    k.text(count === 1 ? 'आजचा वैयक्तिक मार्गदर्शक' : 'आजचे राशिचक्र', 6, count === 1 ? 28 : 20, k.W - 12, 6.5, {
      bold: true, align: 1, ink: '#f2d7da', family: 'sans',
    });

    signs.forEach((sign, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const wideClosingReading = columns === 2 && count % 2 === 1 && index === count - 1;
      const panelWidth = wideClosingReading ? k.W : cellWidth;
      const x = wideClosingReading ? 0 : column * (cellWidth + gutter);
      const y = gridTop + row * cellHeight;
      const panelHeight = cellHeight - 3;
      const hero = count === 1;
      const iconSize = Math.max(16, Math.min(hero ? 58 : 42, panelHeight * (hero ? 0.27 : 0.26), panelWidth * 0.42));
      const nameFont = hero ? 18 : Math.max(8, Math.min(11, bodyFontPx + 2));
      const factFont = hero ? 8.5 : Math.max(5.8, bodyFontPx - 0.7);
      const readingLines = api.wrap(String(sign.text || ''), {
        width: Math.max(1, panelWidth - 12), fontPx: bodyFontPx, family: 'serif', weight: 400,
      }).lines.length;
      const readingHeight = readingLines * api.lineHeight(bodyFontPx, 'serif', 400);
      const clusterHeight = iconSize
        + 3 + api.lineHeight(nameFont, 'serif', 700)
        + 1 + api.lineHeight(factFont, 'sans', 700)
        + (hero ? 7 : 4) + readingHeight;
      // A three-sign feature is a broad, deliberate reading panel. Centre its
      // content rather than leaving a web-card-like void underneath. Dense
      // full-zodiac editions retain the compact top-to-bottom newspaper grid.
      const panelInset = rows === 1 ? Math.max(6, (panelHeight - clusterHeight) / 2) : (hero ? 10 : 5);
      const iconY = y + panelInset;
      const nameY = iconY + iconSize + (hero ? 5 : 3);
      const factsY = nameY + api.lineHeight(nameFont, 'serif', 700) + 1;
      const bodyY = factsY + api.lineHeight(factFont, 'sans', 700) + (hero ? 7 : 4);
      const bodyHeight = Math.max(1, y + panelHeight - bodyY - 4);
      const fill = index % 2 ? '#fcf7f4' : '#f8eeef';

      // A light paper ground and a single red top rule deliberately replace
      // the former UI-like tile borders.
      k.bar(x, y, panelWidth, panelHeight, fill);
      k.bar(x, y, panelWidth, 1.3, RED);
      k.image(api.rashiArtwork?.(sign), x + (panelWidth - iconSize) / 2, iconY, iconSize, iconSize);
      k.text(sign.name, x + 4, nameY, panelWidth - 8, nameFont, { bold: true, align: 1, ink: RED });

      const facts = [
        sign.luckyNumber == null || sign.luckyNumber === '' ? '' : `शुभ अंक ${sign.luckyNumber}`,
        sign.luckyColour ? `शुभ रंग ${sign.luckyColour}` : '',
      ].filter(Boolean).join('  ·  ');
      if (facts) k.text(facts, x + 4, factsY, panelWidth - 8, factFont, { bold: true, align: 1, family: 'sans', ink: '#614c50' });
      const reading = k.text(sign.text || '', x + 6, bodyY, panelWidth - 12, bodyFontPx, { align: 1, family: 'serif' });
      cellOverset ||= reading.height > bodyHeight + 0.1;
    });

    const result = k.finish({
      key: 'rashi', design, geometry: { composition: count === 1 ? 'rashi-hero-reading' : 'zodiac-reading-grid', columns, rows },
    });
    if (cellOverset) result.fitState = 'OVERSET';
    return result;
  };

  const preferred = signs.length === 1 ? [12, 11, 10, 9, 8, 7, 6] : [8, 7.5, 7, 6.5, 6, 5.5];
  let fallback = null;
  for (const candidate of preferred) {
    const result = composeAt(candidate);
    fallback = result;
    if (result.fitState === 'FITS') return result;
  }
  return fallback;
}

/**
 * A second, deliberately unlike Rashi-bhavishya composition.
 *
 * The capsule design is a collection of centred readings. This one is a
 * newspaper horoscope ledger: an ink masthead, ruled horizontal entries and
 * a wide forecast measure. It is a useful distinction for a page designer,
 * not another border treatment. The same neutral primitives go to canvas and
 * every print writer.
 */
function rashiLedger(data, frame, api) {
  const signs = (data.signs || []).filter((sign) => sign?.name).slice(0, 12);
  if (!signs.length) return null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // This is a responsive composition, not a fixed 2-column skin.  A ledger
  // first tries to retain one generous reading measure; when the actual frame
  // cannot hold that, it tries two and then three columns.  The real wrapped
  // copy decides the answer, so a resize cannot leave a technically fitting
  // card with an unnecessarily tiny type size or a stale row structure.
  const columnChoices = (width, count) => {
    if (count === 1) return [1];
    const gap = 5;
    // Below this width a third part of a ledger row is only a caption.  Let
    // preflight call a genuinely narrow frame OVERSET rather than pretending
    // that a few pixels are a readable Marathi forecast.
    const maximum = Math.max(1, Math.min(3, Math.floor((width + gap) / 113)));
    return Array.from({ length: Math.min(count, maximum) }, (_, index) => index + 1);
  };

  const composeAt = (bodyFontPx, requestedColumns) => {
    const k = kit(frame, api);
    const count = signs.length;
    const columns = Math.max(1, Math.min(count, requestedColumns));
    const rows = Math.ceil(count / columns);
    const titleFontPx = clamp(k.W / (count === 1 ? 15 : 19), count === 1 ? 11.5 : 10.5, count === 1 ? 22 : 17);
    const descriptorFontPx = clamp(titleFontPx * 0.47, 6.5, 9.5);
    const headerHeight = clamp(
      titleFontPx * 1.45 + descriptorFontPx + 13,
      count === 1 ? 45 : 37,
      count === 1 ? 72 : 56,
    );
    const top = headerHeight + clamp(k.H * 0.008, 4, 7);
    const horizontalGap = columns > 1 ? clamp(k.W * 0.018, 4, 8) : 0;
    const verticalGap = clamp(k.H * 0.007, 3, 6);
    const panelWidth = (k.W - horizontalGap * (columns - 1)) / columns;
    const availableHeight = Math.max(1, k.H - top);
    const rowAllowance = Math.max(1, (availableHeight - verticalGap * Math.max(0, rows - 1)) / rows);
    let hardOverset = false;

    const factsFor = (sign) => [
      sign.luckyNumber == null || sign.luckyNumber === '' ? '' : `शुभ अंक ${sign.luckyNumber}`,
      sign.luckyColour ? `शुभ रंग ${sign.luckyColour}` : '',
    ].filter(Boolean).join(' · ');

    const specFor = (sign, lead) => {
      const stripeWidth = lead ? 4 : 2;
      const columnGap = clamp(panelWidth * 0.04, 3.5, 7);
      const horizontalPad = clamp(panelWidth * 0.035, 3.5, 7);
      const iconCeiling = lead ? 64 : 42;
      const iconFloor = Math.min(iconCeiling, Math.max(12, bodyFontPx * (lead ? 2.35 : 1.9)));
      const iconSize = Math.max(iconFloor, Math.min(
        iconCeiling,
        panelWidth * (lead ? 0.22 : 0.20),
        rowAllowance * (lead ? 0.54 : 0.44),
      ));
      // `imageRail` is an explicit column.  Centering against it—not against
      // the whole row or a guessed left inset—keeps every downloaded rashi
      // emblem horizontally centred as a panel widens or narrows.
      const imageRailWidth = Math.max(iconSize + horizontalPad * 2, panelWidth * (lead ? 0.24 : 0.22));
      const metaMinimum = Math.min(panelWidth * 0.30, Math.max(36, bodyFontPx * (lead ? 5.4 : 5.1)));
      const metaMaximum = Math.max(metaMinimum, Math.min(lead ? 96 : 74, panelWidth * 0.32));
      const metaWidth = clamp(panelWidth * (lead ? 0.28 : 0.29), metaMinimum, metaMaximum);
      const readingWidth = panelWidth - stripeWidth - imageRailWidth - metaWidth - columnGap * 2;
      const nameFontPx = Math.max(7.5, bodyFontPx + (lead ? 3.5 : 1.5));
      const factsFontPx = Math.max(5.5, bodyFontPx - 0.5);
      const name = api.wrap(String(sign.name || ''), { width: Math.max(1, metaWidth), fontPx: nameFontPx, family: 'serif', weight: 700 });
      const facts = factsFor(sign);
      const factLines = facts ? api.wrap(facts, { width: Math.max(1, metaWidth), fontPx: factsFontPx, family: 'sans', weight: 700 }) : { lines: [], hardOverset: false };
      const reading = api.wrap(String(sign.text || ''), { width: Math.max(1, readingWidth), fontPx: bodyFontPx, family: 'serif', weight: 400 });
      const nameHeight = name.lines.length * api.lineHeight(nameFontPx, 'serif', 700);
      const factsHeight = factLines.lines.length * api.lineHeight(factsFontPx, 'sans', 700);
      const metaHeight = nameHeight + (factLines.lines.length ? 2 + factsHeight : 0);
      const readingHeight = reading.lines.length * api.lineHeight(bodyFontPx, 'serif', 400);
      const padY = clamp(rowAllowance * 0.08, lead ? 7 : 5, lead ? 14 : 10);
      const needed = Math.max(iconSize, metaHeight, readingHeight) + padY * 2;
      return {
        sign, lead, stripeWidth, columnGap, imageRailWidth, padY, iconSize, metaWidth, readingWidth,
        nameFontPx, factsFontPx, facts, nameHeight, factsHeight, metaHeight,
        readingHeight, needed,
        hard: name.hardOverset || factLines.hardOverset || reading.hardOverset || readingWidth < 34,
      };
    };

    // The first horoscope becomes a lead only in a true one-column column.
    // In two columns all entries remain equal ledger rows, avoiding an
    // asymmetrical grid that would leave a dangerous narrow final row.
    const specs = signs.map((sign, index) => specFor(sign, columns === 1 && index === 0));
    hardOverset ||= specs.some((spec) => spec.hard);

    let rowNeeds;
    if (columns === 1) {
      rowNeeds = specs.map((spec) => spec.needed);
    } else {
      rowNeeds = Array.from({ length: rows }, (_, row) => Math.max(
        ...specs.filter((_, index) => Math.floor(index / columns) === row).map((spec) => spec.needed),
      ));
    }
    const requiredHeight = rowNeeds.reduce((sum, value) => sum + value, 0) + verticalGap * Math.max(0, rows - 1);
    hardOverset ||= requiredHeight > availableHeight + 0.1;
    const remaining = Math.max(0, availableHeight - requiredHeight);
    const weights = rowNeeds.map((need, index) => columns === 1 && index === 0 ? 1.35 : 1);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
    const rowHeights = rowNeeds.map((need, index) => need + remaining * weights[index] / totalWeight);
    const rowY = [];
    let cursor = top;
    rowHeights.forEach((height, index) => { rowY[index] = cursor; cursor += height + (index < rowHeights.length - 1 ? verticalGap : 0); });

    // The masthead is intentionally calm: ink, an accent rule and one small
    // descriptor. The entries—not an app-like title treatment—carry the page.
    const accentWidth = clamp(k.W * 0.018, 4, 7);
    const titleX = accentWidth + 6;
    const titleY = Math.max(4, (headerHeight - (titleFontPx * 1.45 + descriptorFontPx + 4)) / 2);
    const descriptorY = titleY + titleFontPx * 1.35;
    k.bar(0, 0, k.W, headerHeight, INK);
    k.bar(0, 0, accentWidth, headerHeight, RED);
    k.bar(accentWidth, headerHeight - 2, k.W - accentWidth, 2, RED);
    k.text('राशीभविष्य', titleX, titleY, k.W - titleX - 7, titleFontPx, {
      bold: true, align: 0, ink: '#fff', family: 'serif',
    });
    k.text(count === 1 ? 'आजचे वैयक्तिक मार्गदर्शन' : 'आजचे राशिचक्र · दैनिक वाचन', titleX, descriptorY, k.W - titleX - 7, descriptorFontPx, {
      bold: true, align: 0, ink: '#ead7d8', family: 'sans',
    });

    const imageRails = [];
    specs.forEach((spec, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * (panelWidth + horizontalGap);
      const y = rowY[row];
      const height = rowHeights[row];
      const leadGround = spec.lead ? '#f2e7e2' : (index % 2 ? '#fbf7f3' : '#f8eeee');
      const innerHeight = Math.max(spec.iconSize, spec.metaHeight, spec.readingHeight);
      const vertical = y + Math.max(spec.padY, (height - innerHeight) / 2);
      const imageY = vertical + (innerHeight - spec.iconSize) / 2;
      const metaY = vertical + (innerHeight - spec.metaHeight) / 2;
      const readingY = vertical + (innerHeight - spec.readingHeight) / 2;
      const imageRailX = x + spec.stripeWidth;
      const imageX = imageRailX + (spec.imageRailWidth - spec.iconSize) / 2;
      const metaX = imageRailX + spec.imageRailWidth + spec.columnGap;
      const readingX = metaX + spec.metaWidth + spec.columnGap;
      const imageFile = api.rashiArtwork?.(spec.sign);

      k.bar(x, y, panelWidth, height, leadGround);
      k.bar(x, y, spec.stripeWidth, height, RED);
      k.bar(x, y + height - 0.7, panelWidth, 0.7, '#d4c1c2');
      k.bar(metaX - spec.columnGap / 2, y + 5, 0.55, Math.max(1, height - 10), '#d9c9ca');
      k.bar(readingX - spec.columnGap / 2, y + 5, 0.55, Math.max(1, height - 10), '#e0d2d1');
      k.image(imageFile, imageX, imageY, spec.iconSize, spec.iconSize);
      imageRails.push({
        x: k.p + imageRailX, width: spec.imageRailWidth,
        imageX: k.p + imageX, imageWidth: spec.iconSize,
      });
      // The sign name is the small row heading, so it sits on the centre of
      // its own facts column; the longer forecast remains a readable left-
      // aligned measure beside it.
      k.text(spec.sign.name, metaX, metaY, spec.metaWidth, spec.nameFontPx, { bold: true, align: 1, ink: RED });
      if (spec.facts) {
        k.text(spec.facts, metaX, metaY + spec.nameHeight + 2, spec.metaWidth, spec.factsFontPx, {
          bold: true, family: 'sans', ink: '#624d50',
        });
      }
      k.text(spec.sign.text || '', readingX, readingY, spec.readingWidth, bodyFontPx, { family: 'serif' });
    });

    const result = k.finish({
      key: 'rashi', design: 'zodiac-ledger',
      geometry: {
        composition: columns === 1 ? 'horoscope-ledger' : `${columns}-column-horoscope-ledger`,
        columns, rows, imageRails,
      },
    });
    if (hardOverset) result.fitState = 'OVERSET';
    return result;
  };

  // The upper rungs let a tall or wide desk block genuinely use the extra
  // room. The old fixed 8.5px ceiling is why a resized ledger looked almost
  // identical at several sizes even though its frame had changed.
  const candidates = signs.length <= 3
    ? [16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5.5]
    : [12, 11, 10, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5];
  // Match kit()'s actual type measure. A card with a larger frame padding
  // must not be offered a column count that only fits in the padding it lost.
  const framePadding = Math.max(3, Number(frame?.padding) || 3);
  const innerWidth = Math.max(1, (Number(frame?.width) || 1) - framePadding * 2);
  let fallback = null;
  for (const fontPx of candidates) {
    for (const columns of columnChoices(innerWidth, signs.length)) {
      const result = composeAt(fontPx, columns);
      fallback = result;
      if (result.fitState === 'FITS') return result;
    }
  }
  return fallback;
}

function havaman(design,data,frame,api){
  if(design!=='weather-desk')return null; const k=kit(frame,api), cities=(data.cities||[]).filter(Boolean), hero=cities[0];if(!hero)return null;
  k.bar(0,0,k.W,86,'#edf3f4');k.text(hero.name,7,5,k.W*.48,12,{bold:true,ink:RED});k.text(`${hero.maxC??''}°`,5,22,k.W*.5,34,{bold:true});k.text(`किमान ${hero.minC??''}°\nपाऊस ${hero.rainMm??''} मिमी · ${hero.rainChance??''}%`,k.W*.52,25,k.W*.44,10,{bold:true,family:'sans'});k.text(hero.condition,7,67,k.W-14,9,{bold:true,align:1});
  let y=92;cities.slice(1).forEach((v,i)=>{const cw=k.W/Math.max(1,cities.length-1),x=i*cw;k.bar(x,y,cw-2,44,i%2?'#f8eeee':'#faf7f2');k.text(v.name,x+2,y+4,cw-4,7,{bold:true,align:1,ink:RED});k.text(`${v.maxC??''}° / ${v.minC??''}°`,x+2,y+16,cw-4,11,{bold:true,align:1});k.text(v.condition,x+2,y+30,cw-4,6.5,{align:1});});
  if(data.asOf)k.text(data.asOf,0,88,k.W,6.5,{align:2,family:'sans',ink:'#665'});if(data.source)k.text(data.source,0,k.H-10,k.W,6.5,{align:2,family:'sans',ink:'#665'});return k.finish({key:'havaman',design,geometry:{composition:'hero-temperature'}});
}

function sudoku(design,data,frame,api){
  if(design!=='puzzle-folio')return null; const k=kit(frame,api), grid=data.grid;if(!Array.isArray(grid)||grid.length!==9||!grid.every(r=>Array.isArray(r)&&r.length===9))return null;const rail=Math.min(55,k.W*.22),size=Math.min(k.H-4,k.W-rail-6),cell=size/9,x=rail+6,y=(k.H-size)/2;
  k.bar(0,0,rail,k.H,INK);k.text('सुडोकू',4,8,rail-8,13,{bold:true,align:1,ink:'#fff'});k.text(data.difficulty||'आजचे कोडे',5,34,rail-10,7,{align:1,ink:'#fff',family:'sans'});k.text('१ ते ९ अंक भरा',5,k.H-35,rail-10,7,{align:1,ink:'#fff'});
  for(let i=0;i<=9;i++){const w=i%3===0?1.4:.4;k.bar(x+i*cell-w/2,y,w,size,INK);k.bar(x,y+i*cell-w/2,size,w,INK);}grid.forEach((row,r)=>row.forEach((v,c)=>{if(Number(v)>0)k.text(String(v),x+c*cell,y+r*cell,cell,cell*.52,{bold:true,align:1});}));return k.finish({key:'sudoku',design,geometry:{composition:'side-folio',cell}});
}

function market(design,data,frame,api){
  if(!['lead-index','chart-led'].includes(design))return null;const k=kit(frame,api),items=(data.items||[]).filter(v=>v?.label&&v.value!=null);if(!items.length)return null;let y=0;
  k.text(data.title||'शेअर / सोने बाजार',0,y,k.W,13,{bold:true,ink:RED});y+=18;if(data.asOf){k.text(data.asOf,0,y,k.W,6.5,{align:2,family:'sans',ink:'#665'});y+=10;}
  if(design==='chart-led'&&Array.isArray(data.trend?.values)&&data.trend.values.length>1){const vals=data.trend.values.map(Number).filter(Number.isFinite),h=54,min=Math.min(...vals),span=Math.max(...vals)-min||1,pts=vals.map((v,i)=>[k.p+i*k.W/(vals.length-1),k.p+y+h-(v-min)/span*h]);k.text(`${data.trendLabel||'बाजाराचा कल'} ${data.trend.label||''}`,0,y,k.W,8,{bold:true,ink:RED});y+=12;k.out.push({kind:'poly',points:pts.map(([x,py])=>[x,py+12]),ink:RED,close:false,strokeWidth:1.4,x:k.p,y:k.p+y,width:k.W,height:h});y+=h+18;}
  // `y` is the top of this whole tiled board. Advancing it inside the loop
  // made every following row use the already-advanced value and pushed a
  // five-rate board outside its block.
  const gap=5,cw=(k.W-gap)/2,tilesTop=y;
  items.forEach((v,i)=>{const x=(i%2)*(cw+gap),yy=tilesTop+Math.floor(i/2)*62;k.bar(x,yy,cw,58,i===0&&design==='lead-index'?INK:'#f5ecee');k.text(`${v.label}${v.unit?` (${v.unit})`:''}`,x+5,yy+5,cw-10,8,{bold:true,ink:i===0&&design==='lead-index'?'#fff':RED,family:'sans'});k.text(v.value,x+5,yy+18,cw-10,18,{bold:true,align:2,ink:i===0&&design==='lead-index'?'#fff':INK,family:'sans'});k.text(`${v.direction==='down'?'▼':'▲'} ${v.delta||''} ${v.change||''}`,x+5,yy+42,cw-10,8,{bold:true,align:2,ink:v.direction==='down'?'#b5263d':'#237548',family:'sans'});});
  y=tilesTop+Math.ceil(items.length/2)*62;
  if(data.note)k.text(data.note,0,y,k.W,7,{family:'serif',ink:'#665'});if(data.source)k.text(data.source,0,k.H-10,k.W,6.5,{align:2,family:'sans',ink:'#665'});return k.finish({key:'market',design,geometry:{composition:design==='chart-led'?'chart-metrics':'lead-metrics'}});
}

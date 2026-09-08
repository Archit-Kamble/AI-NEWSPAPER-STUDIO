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

function rashi(design,data,frame,api){
  if(design!=='zodiac-capsules')return null; const k=kit(frame,api), signs=(data.signs||[]).slice(0,12), cols=k.W>220?3:2,gap=4,cw=(k.W-gap*(cols-1))/cols,rh=k.H/Math.ceil(signs.length/cols);
  signs.forEach((s,i)=>{const c=i%cols,r=Math.floor(i/cols),x=c*(cw+gap),y=r*rh;k.bar(x,y,cw-1,rh-3,i%2?'#fbf4f5':'#fff');k.bar(x,y,2,rh-3,RED);const icon=Math.min(28,rh*.32);k.image(api.rashiArtwork?.(s),x+cw/2-icon/2,y+4,icon,icon);k.text(s.name,x+3,y+icon+5,cw-6,9,{bold:true,align:1,ink:RED});k.text(`शुभ अंक ${s.luckyNumber??''} · शुभ रंग ${s.luckyColour??''}`,x+3,y+icon+17,cw-6,6.5,{bold:true,align:1,family:'sans'});k.text(s.text,x+5,y+icon+27,cw-10,7,{align:1});});
  return k.finish({key:'rashi',design,geometry:{composition:'logo-top',columns:cols}});
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

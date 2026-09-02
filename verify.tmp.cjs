const { chromium } = require('playwright-core');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ED = 51615;
let pass=0,ran=0;const say=(o,w,d='')=>{ran++;if(o)pass++;console.log(`${o?'PASS':'FAIL'}  ${w}${d?' :: '+String(d).slice(0,220):''}`);};
let page, KEY;
// The way back is through the UI, like the way in: there is no PATCH for a
// section's presentational fields (only PUT, a full replace), so a harness
// that invents one silently 404s and leaves the block where it was.
const setBorder = async (style) => {
  const btn = page.locator(`[data-border="${style}"]`).first();
  await btn.scrollIntoViewIfNeeded(); await btn.click(); await page.waitForTimeout(1600);
};
const stored = () => page.evaluate(async([ed,key])=>{
  const pages=await fetch(`/api/newspapers/${ed}/pages`).then(r=>r.json());
  for(const p of pages){const s=p.sections.find(x=>x.section_key===key); if(s) return s.border_style;}},[ED,KEY]);
const edges = () => page.evaluate((key)=>{
  const el=document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
  const cs=getComputedStyle(el); const side=(s)=>`${cs['border'+s+'Style']}/${Math.round(parseFloat(cs['border'+s+'Width'])*100)/100}`;
  return { print: document.body.classList.contains('print-view'),
    cls:[...el.classList].filter(c=>c.startsWith('ruled')).join(' '),
    L:side('Left'),R:side('Right'),T:side('Top'),B:side('Bottom') };},KEY);
(async()=>{
 const b = await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
 page = await (await b.newContext({viewport:{width:1700,height:1300}})).newPage();
 const errs=[];page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 await page.goto('http://localhost:3000'); await page.waitForTimeout(900);
 if (await page.locator('#email').count()){await page.fill('#email','admin@esahas.com');await page.fill('#password','admin123');await page.click('#loginBtn');}
 await page.waitForSelector('.edition-row',{timeout:20000});
 await page.fill('#editionSearch', String(ED)); await page.waitForTimeout(800);
 await page.locator(`.edition-row[data-edition-id="${ED}"] .edition-open`).click();
 await page.waitForSelector('#canvasSurface',{timeout:25000}); await page.waitForTimeout(3000);
 KEY = 'masthead-advert';
 await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).click(); await page.waitForTimeout(2200);
 await page.locator('[data-assist-tab="block"]').first().click(); await page.waitForTimeout(1500);

 const solid=(s)=>s.startsWith('solid');
 const printView = async (on) => {
   const isOn = await page.evaluate(()=>document.body.classList.contains('print-view'));
   if (isOn !== on) { await page.locator('#printViewBtn').click(); await page.waitForTimeout(1500); }
 };
 // The border is SET in normal view - print view clears the desk below the
 // sheet, so the Block Editor and its controls are deliberately not there -
 // and MEASURED in print view, where the editor's own 1px dashed guide is
 // gone and the only border left on the block is the rule itself.
 for (const [style,wantL,wantR] of [['rule-left',true,false],['rule-right',false,true],['rule-sides',true,true],['none',false,false]]) {
   await printView(false);
   await setBorder(style);
   const real = await stored();
   await printView(true);
   const e = await edges();
   say(real===style && e.print && solid(e.L)===wantL && solid(e.R)===wantR && !solid(e.T) && !solid(e.B),
     `6. ${style}: the printed sheet carries exactly that rule and no other`,
     `stored=${real} cls=${e.cls||'(none)'} L=${e.L} R=${e.R} T=${e.T} B=${e.B}`);
 }
 await printView(false);
 const finalState = await stored();
 say(finalState==='none', 'the block this run drove is left as it was found', `border_style=${finalState}`);
 console.log('\npage errors:', errs.length?errs.join(' | '):'none');
 console.log(`${pass}/${ran} passed`);
 await b.close(); process.exit(pass===ran?0:1);
})().catch(e=>{console.log('CRASH',e.message);console.log(`${pass}/${ran} before crash`);process.exit(1);});

const { chromium } = require('playwright-core');
const BASE='http://localhost:3000', ED=Number(process.env.ED||2099), KEY=process.env.KEY||'third-lead';
const SKIP=/publish|press file|logout|write this block|optimi[sz]e with these|prepare card|approve|reject|change page count|remove the selected block/i;
// The app sidebar is a full-screen drawer with a z-index 250 backdrop; it and
// its nav replace the whole view. Driven in its own phase, not inline.
const SIDEBAR=/^(appSidebarToggle|createBtn|draftBtn|submittedBtn|approvedBtn|rejectedBtn|profileBtn|logoutBtn2|pastBtn|pastNewsBtn|reportersBtn|settingsBtn|editionsBtn|newspaperBtn)$/;

const STAMP = () => {
  const seen={};
  const h=(s)=>{let x=5381;for(let i=0;i<s.length;i++)x=((x*33)^s.charCodeAt(i))>>>0;return x;};
  document.querySelectorAll('button, select, [role="button"], input[type=checkbox], input[type=radio]').forEach(el=>{
    const label=(el.getAttribute('aria-label')||el.title||el.textContent||String(el.className)||'').replace(/\s+/g,' ').trim().slice(0,58);
    const panel = el.closest('#workspaceToolsPanel')?'settings-rail':el.closest('.ext-assist-col')?'assist':el.closest('.ext-write-col')?'writing':el.closest('.workspace-canvas-host')?'canvas':'page';
    const base=el.id?`#${el.id}`:`${panel}|${label}|${el.tagName}`;
    seen[base]=(seen[base]||0)+1;
    el.setAttribute('data-swk', String(h(base+'#'+seen[base])));
    el.setAttribute('data-swl', label); el.setAttribute('data-swp', panel);
  });
};

(async()=>{
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1512,height:950}})).newPage();
let bucket=[];
p.on('pageerror',e=>bucket.push('pageerror: '+e.message.slice(0,200)));
p.on('console',m=>m.type()==='error'&&bucket.push('console: '+m.text().slice(0,200)));
p.on('response',r=>{if(r.status()>=400)bucket.push(`HTTP ${r.status()} ${r.url().replace(BASE,'').slice(0,110)}`)});
p.on('dialog',d=>d.dismiss().catch(()=>{}));

await p.goto(BASE); await p.waitForTimeout(900);
if(await p.locator('#email').count()){await p.fill('#email','admin@esahas.com');await p.fill('#password','admin123');await p.click('#loginBtn');}
await p.waitForSelector('.edition-row',{timeout:20000});
await p.evaluate(async([ed,key])=>{const pages=await fetch(`/api/newspapers/${ed}/pages`).then(r=>r.json());
  await fetch(`/api/pages/${pages[0].id}/sections/${key}`,{method:'PUT',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({headline:'चाचणी मथळा',subheading:'चाचणी उपमथळा',body:'पुणे : ही एक चाचणी बातमी आहे. दुसरे वाक्य येथे आहे.',smartCardKey:null,smartCardData:null,status:'draft'})});},[ED,KEY]);
const when=await p.evaluate(ed=>fetch(`/api/newspapers/${ed}`).then(r=>r.json()).then(n=>String(n.publication_date).slice(0,10)),ED);
await p.fill('#editionSearch',when); await p.waitForTimeout(600);
await p.locator(`.edition-row[data-edition-id="${ED}"] button`).click();
await p.waitForSelector('#canvasSurface',{timeout:20000}); await p.waitForTimeout(2500);
async function openWorkspace(){
  await p.goto(BASE); await p.waitForTimeout(800);
  if(await p.locator('#email').count()){await p.fill('#email','admin@esahas.com');await p.fill('#password','admin123');await p.click('#loginBtn');}
  await p.waitForSelector('.edition-row',{timeout:20000});
  await p.fill('#editionSearch',when); await p.waitForTimeout(600);
  await p.locator(`.edition-row[data-edition-id="${ED}"] button`).click();
  await p.waitForSelector('#canvasSurface',{timeout:20000}); await p.waitForTimeout(2200);
  await p.locator(`.newspaper-section[data-section-key="${KEY}"]`).click(); await p.waitForTimeout(1200);
}
async function ensureWorkspace(){
  if(await p.locator('#canvasSurface').count()) return false;
  await openWorkspace(); return true;
}
await p.locator(`.newspaper-section[data-section-key="${KEY}"]`).click(); await p.waitForTimeout(1500);

await p.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true;}));
await p.waitForTimeout(300);
await p.evaluate(STAMP);
const catalog = await p.evaluate(()=>[...document.querySelectorAll('[data-swk]')].filter(el=>{
  const r=el.getBoundingClientRect();
  return r.width>2&&r.height>2&&getComputedStyle(el).visibility!=='hidden'&&!el.disabled;
}).map(el=>({k:el.getAttribute('data-swk'),label:el.getAttribute('data-swl'),panel:el.getAttribute('data-swp'),id:el.id,tag:el.tagName.toLowerCase()})));
console.log(`CONTROLS: ${catalog.length}`);

const report=[];
for(const c of catalog){
  if(SKIP.test(c.label)||SKIP.test(c.id)||SIDEBAR.test(c.id)){report.push({...c,verdict:'SKIPPED'});continue;}
  bucket=[];
  await p.evaluate(STAMP);
  const loc=p.locator(`[data-swk="${c.k}"]`);
  if(!(await loc.count())){report.push({...c,verdict:'GONE'});continue;}
  const size=await loc.first().evaluate(e=>{const r=e.getBoundingClientRect();return [r.width,r.height];});
  if(size[0]<2||size[1]<2){report.push({...c,verdict:'HOVER-ONLY (0x0 until hovered)'});continue;}
  const before=await p.evaluate(()=>document.body.innerHTML.length);
  try{
    if(c.tag==='select'){
      const n=await loc.first().evaluate(e=>e.options.length);
      if(n>1) await loc.first().evaluate(e=>{e.selectedIndex=1;e.dispatchEvent(new Event('change',{bubbles:true}));});
    } else { await loc.first().scrollIntoViewIfNeeded({timeout:2000}).catch(()=>{}); await loc.first().click({timeout:3000}); }
  }catch(e){
    const msg=String(e.message).replace(/\s+/g,' ').slice(0,300);
    if(!global.__shot){global.__shot=1;
      await p.screenshot({path:'/tmp/claude-1000/-home-archit-kamble-ai-newspaper-studio/eb1a2a54-e0f8-4629-bcd1-291a103bbec3/scratchpad/shots/stuck.png'});
      const diag=await p.evaluate((k)=>{
        const el=document.querySelector(`[data-swk="${k}"]`); if(!el) return 'element gone';
        const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
        const at=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
        const chain=[]; let n=at; while(n&&chain.length<5){chain.push(`${n.tagName}${n.id?'#'+n.id:''}.${String(n.className).slice(0,30)}`);n=n.parentElement;}
        return {rect:[r.x|0,r.y|0,r.width|0,r.height|0], vis:cs.visibility, disp:cs.display, op:cs.opacity, pe:cs.pointerEvents,
                inViewport: r.top>=0&&r.bottom<=innerHeight, atPoint:chain, isSelf: at===el||el.contains(at)};
      }, c.k);
      console.log('FIRST STUCK ON:',c.label,'\n',JSON.stringify(diag,null,1),'\n',msg);}
    report.push({...c,verdict:'UNCLICKABLE: '+msg.slice(0,150)});continue;}
  await p.waitForTimeout(450);
  const after=await p.evaluate(()=>document.body.innerHTML.length);
  const errs=[...new Set(bucket)];
  report.push({...c,verdict:errs.length?'ERRORS: '+errs.join(' | '):(before===after?'no-dom-change':'ok')});
  await p.keyboard.press('Escape').catch(()=>{}); await p.waitForTimeout(120);
  // Anything modal this click opened, shut - or it masks every later one.
  await p.evaluate(()=>{
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-app-backdrop')?.classList.remove('open');
    document.querySelector('.sidebar-backdrop')?.classList.remove('open');
    document.querySelectorAll('.modal-root.open').forEach(e=>e.classList.remove('open'));
    document.querySelector('.story-editor.is-fullscreen')?.classList.remove('is-fullscreen');
    ['preflightPanel','worklistPanel','bulkPanel','sectionRatePanel','fitPanel'].forEach(id=>document.getElementById(id)?.remove());
    document.querySelectorAll('.drawer.open, .story-picker-drawer.open, .story-explorer.open, .workspace-sidebar-left.open, #sidebarLeft.open').forEach(e=>e.classList.remove('open'));
    document.body.classList.remove('print-view');
    document.querySelectorAll('details').forEach(d=>{d.open=true;});
    document.querySelector('.editor-collapsed')?.classList.remove('editor-collapsed');
  });
  await p.waitForTimeout(80);
  if(await ensureWorkspace()) report[report.length-1].verdict += ' [navigated away; workspace reopened]';
}
const show=(t,f)=>{console.log(`\n===== ${t} =====`);const r=report.filter(f);r.forEach(x=>console.log(`[${x.panel}] ${x.label} (${x.id||x.tag})\n     ${x.verdict}`));if(!r.length)console.log('(none)');};
show('ERRORED',r=>r.verdict.startsWith('ERRORS'));
show('UNCLICKABLE',r=>r.verdict.startsWith('UNCLICKABLE'));
show('NO DOM CHANGE (possibly dead)',r=>r.verdict==='no-dom-change');
show('GONE',r=>r.verdict==='GONE');
console.log('\nSUMMARY',JSON.stringify(report.reduce((a,r)=>{const k=r.verdict.split(':')[0].split(' ')[0];a[k]=(a[k]||0)+1;return a;},{})));
await b.close();
})();

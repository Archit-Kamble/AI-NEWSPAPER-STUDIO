const { chromium } = require('playwright-core');
const SP='/tmp/claude-1000/-home-archit-kamble-ai-newspaper-studio/eb1a2a54-e0f8-4629-bcd1-291a103bbec3/scratchpad';
const hold = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b = await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 const page = await (await b.newContext({viewport:{width:1500,height:1000},deviceScaleFactor:2})).newPage();
 let held=false;
 await page.route('**/api/auth/login', async r => { if(!held){held=true;await hold(6000);} await r.continue(); });
 await page.goto('http://localhost:3000'); await page.waitForTimeout(1000);
 await page.fill('#email','admin@esahas.com'); await page.fill('#password','admin123');
 await page.click('#loginBtn'); await page.waitForTimeout(1200);
 const card = await page.locator('.login-card, form, #loginBtn').first();
 await card.screenshot({path: SP+'/shot-login.png'}).catch(async()=>{ await page.screenshot({path:SP+'/shot-login.png'}); });
 await page.waitForSelector('.edition-row',{timeout:25000});

 await page.locator('.edition-row .edition-open').first().click();
 await page.waitForSelector('#canvasSurface',{timeout:25000}); await page.waitForTimeout(3000);
 await page.evaluate(()=>document.querySelector('.newspaper-section')?.click());
 await page.waitForTimeout(2200);
 await page.route('**/sections/*/write', async r => { await hold(9000);
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({error:'ZZ probe'})}); });
 await page.locator('[data-assist-tab="ai"]').first().click(); await page.waitForTimeout(1200);
 if (await page.locator('#edAiSeed').count()) await page.fill('#edAiSeed','ZZ probe seed');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/write this block/i.test(b.textContent))?.click());
 await page.waitForTimeout(1600);
 const host = page.locator('#aiStoryProposal');
 await host.scrollIntoViewIfNeeded();
 // capture the button and the skeleton together
 const col = page.locator('.ext-assist-col').first();
 await (await col.count() ? col : host).screenshot({path: SP+'/shot-ai.png'});
 console.log('shots taken');
 await b.close();
})();

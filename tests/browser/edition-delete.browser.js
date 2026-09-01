// DELETING AN EDITION, THROUGH THE DOOR A DESK USES.
//
// tests/editionDelete.test.js holds the route and its one refusal. What it
// cannot see is the half that decides whether the feature is safe: the
// question the desk is asked before anything goes. A confirmation reading
// "Delete edition 59386?" asks about an id, nobody knows what is in an id, and
// a desk quickly learns to dismiss a question it cannot answer.
//
// So this checks what the sentence SAYS, and that Cancel means cancel.
//
//   node tests/browser/edition-delete.browser.js
//
// It makes its own throwaway edition and removes it, so it can be run
// repeatedly. Needs playwright-core and Chrome at /usr/bin/google-chrome
// (CHROME_PATH overrides), against a running server on :3000.

const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:3000';
let pass=0, fail=0;
const check=(n,ok,d='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${d?` :: ${d}`:''}`);};
(async()=>{
  const b = await chromium.launch({ executablePath:'/usr/bin/google-chrome' });
  const p = await b.newPage({ viewport:{width:1512,height:950} });
  const errors=[]; p.on('pageerror',e=>errors.push(e.message.slice(0,140)));
  // THE QUESTION IS THE PAPER'S OWN NOW, NOT THE OPERATING SYSTEM'S.
  //
  // This net was written against `window.confirm` and never updated when the
  // forty native dialogs became `public/ui/dialog.js`. So it sat waiting for a
  // 'dialog' event that no longer fires: five checks failed, "CANCEL leaves
  // the edition alone" PASSED for the wrong reason (nothing was deleted
  // because the question was still open and unanswered), and the run then
  // crashed 30s later with the dialog's own backdrop intercepting the next
  // click. A net pinned to a mechanism, outliving the mechanism.
  //
  // Nothing may reach the operating system any more, so that is asserted
  // rather than handled - the same inversion admin-screens.browser.js makes.
  let nativeDialog=null;
  p.on('dialog', async d=>{ nativeDialog=d.message(); await d.dismiss(); });
  // The close button is a lone "×" line inside the dialog, so it lands between
  // the title and the first sentence and becomes whatever a check reports as
  // its detail. Dropped, or the net's own output lies about what the desk read.
  const askedText = async () => (await p.locator('.sahas-dialog').innerText())
    .split('\n').filter((line) => line.trim() && line.trim() !== '×').join('\n');
  const answerWith = async (selector) => {
    await p.locator(selector).first().click();
    await p.waitForSelector('.sahas-dialog', { state:'detached', timeout:8000 });
  };
  try {
    await p.goto(BASE,{waitUntil:'networkidle'});
    if (await p.locator('#email').count()) { await p.fill('#email','admin@esahas.com'); await p.fill('#password','admin123'); await p.click('#loginBtn'); }
    await p.waitForSelector('.edition-row',{timeout:25000});

    // Its own fixture, on a 2099 date so it can never be mistaken for real
    // work, made through the session the browser already holds.
    const ID = String(await p.evaluate(async () => {
      const made = await fetch('/api/newspapers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ZZ browser delete probe', publicationDate: '2099-03-14' }),
      }).then((r) => r.json());
      await fetch(`/api/newspapers/${made.id}/pages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
      });
      return made.id;
    }));
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('.edition-row',{timeout:25000});

    // find the probe row (it may be past the recent limit, so search for it)
    await p.fill('#editionSearch','2099-03-14');
    await p.waitForTimeout(500);
    const row = p.locator(`.edition-row[data-edition-id="${ID}"]`);
    check('the throwaway edition is listed', await row.count()===1, `id ${ID}`);
    check('and it has a Delete button', await row.locator('.edition-delete').count()===1);

    // --- CANCEL must not delete -------------------------------------------
    await row.locator('.edition-delete').click();
    await p.waitForSelector('.sahas-dialog', { timeout:8000 });
    const question = await askedText();
    check('it asks before it deletes', /Delete the edition/.test(question));
    check('  and it does not do it through the operating system', nativeDialog===null, String(nativeDialog));
    check('  and the question names the DATE, not the id', question.includes('2099-03-14'), question.split('\n')[0]);
    check('  and says what is in it', /blocks|written into it/.test(question),
      question.split('\n').filter(Boolean)[1] || '');
    check('  and says it cannot be undone', /cannot be undone/.test(question));
    check("  and says reporters' filings are safe", /filings are not affected/i.test(question));
    await answerWith('.sahas-dialog-btn.is-quiet');
    check('CANCEL leaves the edition alone', await p.locator(`.edition-row[data-edition-id="${ID}"]`).count()===1);

    // --- accepting really removes it --------------------------------------
    await p.locator(`.edition-row[data-edition-id="${ID}"] .edition-delete`).click();
    await p.waitForSelector('.sahas-dialog', { timeout:8000 });
    // The destructive button, by its own class - naming it by its words would
    // pin this net to a sentence the desk may reword.
    await answerWith('.sahas-dialog-btn.is-destructive');
    await p.waitForTimeout(2500);
    check('accepting removes the row', await p.locator(`.edition-row[data-edition-id="${ID}"]`).count()===0);
    check('  and the desk keeps its search', await p.inputValue('#editionSearch')==='2099-03-14',
      await p.inputValue('#editionSearch'));

    const gone = await p.evaluate(async (id)=> (await fetch(`/api/newspapers/${id}`)).status, ID);
    check('  and the edition is really gone from the server', gone===404, `GET -> ${gone}`);

    console.log('\npage errors:', errors.length?errors.join(' | '):'none');
  } catch(e){ console.log('CRASH ::', e.message); fail++; }
  // A net that makes a real edition must remove it even when it dies half way,
  // or the next run finds yesterday's fixture and the database grows the way
  // it grew to 221 editions in the first place.
  try {
    await p.evaluate(async () => {
      const all = await fetch('/api/newspapers').then((r) => r.json());
      for (const e of all.filter((x) => String(x.name || '').startsWith('ZZ browser delete probe'))) {
        await fetch(`/api/newspapers/${e.id}`, { method: 'DELETE' });
      }
    });
  } catch { /* the browser may already be gone */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail?1:0);
})();

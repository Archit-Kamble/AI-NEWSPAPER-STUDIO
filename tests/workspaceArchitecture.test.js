// Stage 6's own audit: the task that requested this stage described
// admin.js as containing a competing renderWorkspace/newspaperTemplates
// implementation alongside public/admin/newspaper-workspace.js and
// public/admin/page-editor.js. None of that was found at commit ed98d57 -
// those two files never existed in this repository's git history, and
// admin.js only imports the one real renderWorkspace from editor/workspace.js
// and calls it, defining nothing of its own. The consolidation this stage
// asked for had already happened. These checks hold that finding in place,
// so a future change can't silently reintroduce a second workspace the way
// the old, since-removed admin.js newspaperTemplates object once did (see
// the "Terminology" / "Template definitions" sections of CLAUDE.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const read = (relPath) => fs.readFileSync(path.join(PUBLIC_DIR, relPath), 'utf8');

test('admin.js does not define its own renderWorkspace - it only imports the real one', () => {
  const source = read('admin.js');
  assert.match(source, /import\s*\{\s*renderWorkspace\s*\}\s*from\s*["']\.\/editor\/workspace\.js["']/);
  assert.doesNotMatch(source, /function\s+renderWorkspace\s*\(/);
});

test('admin.js carries no second template catalog', () => {
  const source = read('admin.js');
  for (const banned of ['newspaperTemplates', 'availableTemplates', 'renderPageCanvas', 'renderSectionEditor', 'selectPageTemplates', 'showSectionEditor']) {
    assert.doesNotMatch(source, new RegExp(banned), `admin.js must not reintroduce ${banned}`);
  }
});

test('exactly one module exports renderWorkspace', () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') && /export\s+(async\s+)?function\s+renderWorkspace\s*\(/.test(fs.readFileSync(full, 'utf8'))) {
        hits.push(path.relative(PUBLIC_DIR, full));
      }
    }
  };
  walk(PUBLIC_DIR);
  assert.deepEqual(hits, ['editor/workspace.js']);
});

test('the once-competing admin workspace files do not exist', () => {
  for (const relPath of ['admin/newspaper-workspace.js', 'admin/page-editor.js']) {
    assert.equal(fs.existsSync(path.join(PUBLIC_DIR, relPath)), false, `${relPath} should not exist`);
  }
});

test('no window-global workspace state has been introduced', () => {
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  };
  const banned = ['window.currentNewspaper', 'window.currentPage', 'window.reporterNews', 'window.availableTemplates', 'window.selectedSection'];
  for (const file of walk(PUBLIC_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const symbol of banned) {
      assert.doesNotMatch(source, new RegExp(symbol.replace('.', '\\.')), `${symbol} found in ${path.relative(PUBLIC_DIR, file)}`);
    }
  }
});

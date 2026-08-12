#!/usr/bin/env node
/*
 * Deliberate maintenance tool for synchronising persisted template-owned
 * rectangles.  It is not an HTTP endpoint and defaults to a no-write preview.
 */
require('dotenv').config();

const newspaperRepository = require('../src/repositories/newspaper.repository');
const pageRepository = require('../src/repositories/page.repository');
const pool = require('../src/config/db');

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node scripts/reapply-edition-layout.js --date YYYY-MM-DD [--edition-id ID] [--dry-run|--apply]');
}

function parseArguments(argv) {
  const args = { apply: false, dryRun: true, date: null, editionId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') args.date = argv[++index] || null;
    else if (arg === '--edition-id') args.editionId = argv[++index] || null;
    else if (arg === '--apply') { args.apply = true; args.dryRun = false; }
    else if (arg === '--dry-run') { args.apply = false; args.dryRun = true; }
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(`${args.date}T00:00:00Z`))) {
    throw new Error('an exact valid --date YYYY-MM-DD is required');
  }
  if (args.editionId !== null && !/^\d+$/.test(String(args.editionId))) throw new Error('--edition-id must be a numeric ID');
  return args;
}

function printPreview(preview) {
  for (const page of preview) {
    for (const change of page.changes) {
      console.log(`P${page.pageNumber} ${change.sectionKey}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
    }
    for (const missing of page.missing) console.log(`P${page.pageNumber} MISSING ${missing}`);
  }
  console.log(`Geometry changes: ${preview.reduce((count, page) => count + page.changes.length, 0)}`);
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const candidates = await newspaperRepository.findAllByDate(args.date);
  const editions = args.editionId === null ? candidates : candidates.filter((edition) => Number(edition.id) === Number(args.editionId));
  if (editions.length !== 1) {
    const qualifier = candidates.length > 1 && args.editionId === null
      ? `date ${args.date} is ambiguous; pass --edition-id (${candidates.map((edition) => edition.id).join(', ')})`
      : `no unique edition matches date ${args.date}`;
    throw new Error(qualifier);
  }
  const edition = editions[0];
  const preview = await pageRepository.previewEditionTemplateGeometry(edition.id);
  console.log(`${args.dryRun ? 'DRY RUN' : 'APPLY'} edition ${edition.id} (${args.date})`);
  printPreview(preview);
  if (args.dryRun) return { edition, preview, applied: false };
  const result = await pageRepository.reapplyEditionTemplateGeometry(edition.id);
  console.log(`Applied ${result.before.reduce((count, page) => count + page.changes.length, 0)} geometry changes transactionally.`);
  return { edition, preview: result.before, applied: true };
}

if (require.main === module) {
  run().catch((error) => { usage(error.message); process.exitCode = 1; }).finally(() => pool.end());
}

module.exports = { parseArguments, run };

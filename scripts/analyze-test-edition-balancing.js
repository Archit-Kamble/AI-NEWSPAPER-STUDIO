// Read-only dry run of B5 composition planning for the deterministic edition.
require('dotenv').config();
const newspaperRepository = require('../src/repositories/newspaper.repository');
const pageRepository = require('../src/repositories/page.repository');
const { getTemplate } = require('../src/layout/templates');
const { analyzeLayout } = require('../src/layout/layout-quality');
const { analyzeComposedLayout } = require('../src/layout/composed-layout-quality');
const { compositionInputForPage } = require('../src/layout/composition-adapter');
const { rebalancePageAssignments, candidatePage } = require('../src/layout/page-balancer');
const pool = require('../src/config/db');

async function continuationSourceIds(newspaperId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT continued_from_section_id FROM page_sections ps JOIN pages p ON p.id = ps.page_id
      WHERE p.newspaper_id = $1 AND continued_from_section_id IS NOT NULL`, [newspaperId],
  );
  return new Set(rows.map((row) => row.continued_from_section_id));
}

async function main() {
  const newspaper = await newspaperRepository.findByDate('2099-05-01');
  if (!newspaper) throw new Error('No deterministic test edition for 2099-05-01. Run scripts/build-test-edition.js first.');
  const sources = await continuationSourceIds(newspaper.id);
  const pages = await pageRepository.findByNewspaper(newspaper.id);
  for (const page of pages) {
    const template = getTemplate(page.template_key);
    const input = compositionInputForPage(page, template, { continuationSourceIds: sources });
    const lockedKeys = new Set(input.lockedSections.map((item) => item.sectionKey));
    const fixedSections = page.sections.filter((section) => lockedKeys.has(section.section_key));
    const current = analyzeLayout(page, newspaper);
    const enriched = await analyzeComposedLayout(page, newspaper);
    // This is a rebalance dry run, not an independent B5A re-layout: start
    // from every movable section's own physical frame, then report only real
    // local improvements from the current composition.
    const currentPlan = {
      assignments: input.movableStories.map((story) => ({ storyId: story.id, frameId: story.id })),
    };
    const balanceContext = { newspaper, page, fixedSections, initialPlan: currentPlan };
    const result = rebalancePageAssignments(input.movableStories, input.candidateFrames, balanceContext);
    const finalFrameByStory = new Map(result.finalPlan.assignments.map((item) => [String(item.storyId), String(item.frameId)]));
    const finalState = input.movableStories.map((story) => input.candidateFrames.findIndex(
      (frame) => String(frame.id) === finalFrameByStory.get(String(story.id)),
    ));
    const proposed = analyzeLayout(candidatePage(finalState, input.movableStories, input.candidateFrames, balanceContext), newspaper);
    const changes = result.improvements.map((item) => `${item.type}:${item.affectedStories.join(',')}→${item.affectedFrames.join(',')}`);
    const worst = enriched.sections.filter((section) => section.measured).sort((a, b) => a.effectiveContentRatio - b.effectiveContentRatio).slice(0, 3);
    const severe = enriched.findings.filter((item) => item.code === 'SEVERELY_UNDERFILLED_SECTION').length;
    console.log(`PAGE ${page.page_number} | occupancy ${current.metrics.occupancyRatio} | effective ${enriched.metrics.effectiveUtilizationRatio} | geometry ${current.score} | enriched ${enriched.score} | proposed ${proposed.score} | objective ${result.initialObjective}→${result.finalObjective} | changes ${changes.length} | locked ${input.lockedSections.length} | underfilled ${severe}`);
    if (worst.length) console.log(`  worst: ${worst.map((item) => `${item.sectionKey}[${item.storyType}/p${item.editorialPriority} area:${item.frameAreaRatio} body:${item.bodyFillRatio} image:${item.imageRatio} effective:${item.effectiveContentRatio}]`).join('; ')}`);
    if (input.lockedSections.length) console.log(`  locked: ${input.lockedSections.map((item) => `${item.sectionKey}:${item.reason}`).join(', ')}`);
  }
}
main().then(() => pool.end()).catch((error) => { console.error(error); pool.end().finally(() => process.exit(1)); });

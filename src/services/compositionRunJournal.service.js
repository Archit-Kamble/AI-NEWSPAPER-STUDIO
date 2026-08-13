const fs = require('fs');
const path = require('path');

function safe(value) { return String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 280); }
function journalPath({ date, allPages, pageNumber }) { return path.join('/tmp', `sahas-b8b-run-${date}-${allPages ? 'all-pages' : `page-${pageNumber}`}.json`); }
function createRunJournal(options = {}) {
  const file = journalPath(options);
  const state = { schemaVersion: 1, runId: `${options.date}-${Date.now()}`, date: options.date, pageNumber: options.pageNumber || null, allPages: Boolean(options.allPages), events: [], startedAt: new Date().toISOString(), status: 'RUNNING' };
  function flush() { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(state, null, 2)); fs.renameSync(temp, file); }
  function event(type, data = {}) { state.events.push({ type, at: new Date().toISOString(), ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'string' ? safe(value) : value])) }); flush(); }
  event('RUN_STARTED', { mode: options.mode || 'unknown' });
  return { path: file, state, event, finish(status, data = {}) { state.status = status; state.finishedAt = new Date().toISOString(); event(status === 'COMPLETE' ? 'RUN_COMPLETE' : 'RUN_BLOCKED', data); } };
}
module.exports = { createRunJournal, journalPath };

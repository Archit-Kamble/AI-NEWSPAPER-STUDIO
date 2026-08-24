import { escapeHtml } from '../editor/format.js';

const dateTime = (value) => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : '—';
const searchText = (reporter) => `${reporter.name} ${reporter.email} ${reporter.district || ''} ${reporter.beat || ''}`.toLocaleLowerCase();

function reporterRow(reporter) {
  return `<article class="reporter-row ${reporter.is_active ? '' : 'reporter-row--blocked'}" data-reporter-row data-search="${escapeHtml(searchText(reporter))}">
    <div class="reporter-avatar" aria-hidden="true">${escapeHtml((reporter.name || '?').trim().slice(0, 1).toUpperCase())}</div>
    <div class="reporter-row-copy"><h3>${escapeHtml(reporter.name)}</h3><p>${escapeHtml(reporter.email)}${reporter.phone ? ` · ${escapeHtml(reporter.phone)}` : ''}</p><small>${escapeHtml([reporter.district, reporter.beat].filter(Boolean).join(' · ') || 'No district or beat assigned')} · Last filing ${escapeHtml(dateTime(reporter.last_filed_at))}</small></div>
    <div class="reporter-counts"><span><b>${Number(reporter.story_count) || 0}</b> filed</span><span><b>${Number(reporter.pending_count) || 0}</b> awaiting review</span></div>
    <div class="reporter-row-actions"><span class="status-pill ${reporter.is_active ? 'approved' : 'rejected'}">${reporter.is_active ? 'Active' : 'Blocked'}</span><button class="btn-secondary" type="button" data-open-reporter="${reporter.id}">Profile</button></div>
  </article>`;
}

function reviewerStory(story) {
  const canReview = ['draft', 'pending', 'rejected'].includes(story.status);
  return `<article class="reporter-story"><div><h4>${escapeHtml(story.title)}</h4><p>${escapeHtml(story.subheading || '')}</p><small>${escapeHtml(story.category || 'Uncategorised')} · ${escapeHtml(story.location || 'No location')} · ${escapeHtml(dateTime(story.updated_at || story.created_at))}</small>${story.review_note ? `<p class="review-note"><b>Review note:</b> ${escapeHtml(story.review_note)}</p>` : ''}</div><div class="reporter-story-actions"><span class="status-pill ${escapeHtml(story.status || 'draft')}">${escapeHtml(story.status || 'draft')}</span>${canReview ? `<button class="btn-secondary" type="button" data-review-story="${story.id}" data-review-status="approved">Approve</button><button class="btn-secondary reporter-reject" type="button" data-review-story="${story.id}" data-review-status="rejected">Reject</button>` : ''}</div></article>`;
}

export async function renderReporterManagement(host, { rightPanel } = {}) {
  if (rightPanel) rightPanel.innerHTML = '<h3>Reporters</h3><p>Create and manage real reporter accounts. Blocking immediately prevents filing while preserving their work and review history.</p>';
  host.innerHTML = '<div class="form-section"><h2>Reporters</h2><p class="muted">Loading reporter accounts…</p></div>';
  let reporters;
  try {
    const response = await fetch('/api/reporters');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    reporters = await response.json();
  } catch (error) {
    console.error('Reporter list failed:', error);
    host.innerHTML = '<div class="form-section"><h2>Reporters</h2><p>Reporter accounts could not be loaded.</p></div>';
    return;
  }

  host.innerHTML = `<div class="form-section reporter-admin">
    <div class="reporter-admin-heading"><div><h2>Reporters</h2><p>Search a reporter, open their full profile, and review their filed news without leaving the newsroom.</p></div><button class="btn-submit" type="button" data-add-reporter>Add reporter</button></div>
    <label class="reporter-search"><span>Search reporter</span><input type="search" placeholder="Name, email, district or beat…" data-reporter-search></label>
    <div class="reporter-list" data-reporter-list>${reporters.map(reporterRow).join('') || '<p class="muted">No reporters have been added yet.</p>'}</div>
  </div>`;

  const search = host.querySelector('[data-reporter-search]');
  const rows = [...host.querySelectorAll('[data-reporter-row]')];
  search.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase();
    rows.forEach((row) => { row.hidden = Boolean(query) && !row.dataset.search.includes(query); });
  });
  host.querySelector('[data-add-reporter]').addEventListener('click', () => renderReporterForm(host, { rightPanel, onSaved: () => renderReporterManagement(host, { rightPanel }) }));
  host.querySelectorAll('[data-open-reporter]').forEach((button) => button.addEventListener('click', () => renderReporterProfile(host, Number(button.dataset.openReporter), { rightPanel, onBack: () => renderReporterManagement(host, { rightPanel }) })));
}

function renderReporterForm(host, { rightPanel, reporter = null, onSaved }) {
  if (rightPanel) rightPanel.innerHTML = `<h3>${reporter ? 'Edit reporter' : 'New reporter'}</h3><p>${reporter ? 'Update contact and coverage details. Login access is managed from the profile.' : 'The owner sets the reporter’s initial sign-in password. Share it privately and ask them to change it after first sign-in.'}</p>`;
  host.innerHTML = `<div class="form-section reporter-form"><div class="reporter-admin-heading"><div><h2>${reporter ? 'Edit reporter' : 'Add reporter'}</h2><p>Only the newspaper owner can see or change account details.</p></div><button class="btn-secondary" type="button" data-reporter-cancel>Back</button></div>
    <form data-reporter-form><div class="form-row"><label class="form-group">Name *<input name="name" required maxlength="120" value="${escapeHtml(reporter?.name || '')}"></label><label class="form-group">Email *<input type="email" name="email" required maxlength="255" value="${escapeHtml(reporter?.email || '')}"></label></div>
    ${reporter ? '' : '<label class="form-group">Initial password *<input type="password" name="password" required minlength="8" autocomplete="new-password"><small>At least 8 characters.</small></label>'}
    <div class="form-row"><label class="form-group">Phone<input name="phone" maxlength="40" value="${escapeHtml(reporter?.phone || '')}"></label><label class="form-group">District<input name="district" maxlength="120" value="${escapeHtml(reporter?.district || '')}"></label></div>
    <label class="form-group">Beat / coverage<input name="beat" maxlength="120" placeholder="City, politics, sports…" value="${escapeHtml(reporter?.beat || '')}"></label><label class="form-group">Owner notes<textarea name="notes" maxlength="4000" placeholder="Assignment notes, not published with stories…">${escapeHtml(reporter?.notes || '')}</textarea></label>
    <button class="btn-submit" type="submit">${reporter ? 'Save reporter' : 'Create reporter login'}</button></form></div>`;
  host.querySelector('[data-reporter-cancel]').addEventListener('click', onSaved);
  host.querySelector('[data-reporter-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    button.disabled = true;
    const response = await fetch(reporter ? `/api/reporters/${reporter.id}` : '/api/reporters', { method: reporter ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { button.disabled = false; return window.alert(result.error || 'Reporter could not be saved.'); }
    onSaved();
  });
}

async function renderReporterProfile(host, id, { rightPanel, onBack }) {
  host.innerHTML = '<div class="form-section"><p class="muted">Loading reporter profile…</p></div>';
  const response = await fetch(`/api/reporters/${id}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { host.innerHTML = '<div class="form-section"><p>Reporter profile could not be loaded.</p></div>'; return; }
  const { reporter, stories } = data;
  if (rightPanel) rightPanel.innerHTML = `<h3>${escapeHtml(reporter.name)}</h3><p>${reporter.is_active ? 'Account can sign in and file stories.' : 'Account is blocked and cannot sign in or file stories.'}</p><p><b>${stories.length}</b> stories are retained in this reporter’s record.</p>`;
  host.innerHTML = `<div class="form-section reporter-profile"><div class="reporter-admin-heading"><div><h2>${escapeHtml(reporter.name)}</h2><p>${escapeHtml(reporter.email)} · joined ${escapeHtml(dateTime(reporter.created_at))}</p></div><button class="btn-secondary" type="button" data-reporter-back>Back to reporters</button></div>
    <div class="reporter-profile-grid"><div><h3>Account details</h3><dl><dt>Phone</dt><dd>${escapeHtml(reporter.phone || '—')}</dd><dt>District</dt><dd>${escapeHtml(reporter.district || '—')}</dd><dt>Beat</dt><dd>${escapeHtml(reporter.beat || '—')}</dd><dt>Owner notes</dt><dd>${escapeHtml(reporter.notes || '—')}</dd></dl><div class="reporter-profile-controls"><button class="btn-secondary" type="button" data-edit-reporter>Edit details</button><button class="btn-secondary ${reporter.is_active ? 'reporter-reject' : ''}" type="button" data-reporter-access>${reporter.is_active ? 'Block reporter' : 'Restore reporter'}</button></div></div><div><h3>Filing record</h3><div class="reporter-stories">${stories.map(reviewerStory).join('') || '<p class="muted">No news filed yet.</p>'}</div></div></div>
  </div>`;
  host.querySelector('[data-reporter-back]').addEventListener('click', onBack);
  host.querySelector('[data-edit-reporter]').addEventListener('click', () => renderReporterForm(host, { rightPanel, reporter, onSaved: () => renderReporterProfile(host, id, { rightPanel, onBack }) }));
  host.querySelector('[data-reporter-access]').addEventListener('click', async () => {
    const active = !reporter.is_active;
    if (!window.confirm(active ? `Restore ${reporter.name}'s login?` : `Block ${reporter.name}? Their existing stories will remain visible but they cannot sign in or file new news.`)) return;
    const save = await fetch(`/api/reporters/${id}/access`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) });
    if (!save.ok) return window.alert('Reporter access could not be changed.');
    renderReporterProfile(host, id, { rightPanel, onBack });
  });
  host.querySelectorAll('[data-review-story]').forEach((button) => button.addEventListener('click', async () => {
    const status = button.dataset.reviewStatus;
    const reviewNote = status === 'rejected' ? window.prompt('Tell the reporter what needs correction (optional):', '') : '';
    if (reviewNote === null) return;
    button.disabled = true;
    const save = await fetch(`/api/news/${button.dataset.reviewStory}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, reviewNote }) });
    if (!save.ok) { button.disabled = false; return window.alert('Story review could not be saved.'); }
    renderReporterProfile(host, id, { rightPanel, onBack });
  }));
}

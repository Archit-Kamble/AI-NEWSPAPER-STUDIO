// THE PAPER'S OWN STAFF - every login, of every role.
//
// This was the Reporters screen and it could only ever be that: the repository
// under it said `WHERE u.role = 'reporter'` in five places, so an editor or a
// Sampadak would have been an account nothing in the product could show, edit
// or block. The owner is the only person who reaches this screen, and it is
// now the one place a login is made, given its role, or taken away.
//
// The ROLES ARE FETCHED, from /api/staff/roles, rather than written into a
// <select> here. A second list of those keys in the browser is a catalogue that
// drifts, and this product has been bitten by that twice - the drifted template
// keys, and `object-fit: cover` against `contain`.
import { escapeHtml } from '../editor/format.js';

let ROLES = [];
const roleLabel = (key) => ROLES.find((r) => r.key === key)?.label || key || '';
const roleMarathi = (key) => ROLES.find((r) => r.key === key)?.marathi || '';

async function loadRoles() {
  if (ROLES.length) return ROLES;
  try {
    const response = await fetch('/api/staff/roles');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ROLES = await response.json();
  } catch (error) {
    // Only a good answer is cached, so the next render asks again - the exact
    // rule the templates and geometry caches had to learn after one blip took
    // the Layout picker out for a whole session.
    console.error('Role list failed:', error);
    ROLES = [];
  }
  return ROLES;
}

const dateTime = (value) => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : '—';
const searchText = (person) => `${person.name} ${person.email} ${person.district || ''} ${person.beat || ''} ${roleLabel(person.role)} ${roleMarathi(person.role)}`.toLocaleLowerCase();

// A role is what the row is FOR, so it is on the row and not only inside the
// profile. Without it the owner's list of a dozen logins is a dozen names.
function reporterRow(reporter) {
  return `<article class="reporter-row ${reporter.is_active ? '' : 'reporter-row--blocked'}" data-reporter-row data-role="${escapeHtml(reporter.role)}" data-search="${escapeHtml(searchText(reporter))}">
    <div class="reporter-avatar" aria-hidden="true">${escapeHtml((reporter.name || '?').trim().slice(0, 1).toUpperCase())}</div>
    <div class="reporter-row-copy"><h3>${escapeHtml(reporter.name)} <span class="role-pill role-${escapeHtml(reporter.role)}">${escapeHtml(roleLabel(reporter.role))}${roleMarathi(reporter.role) ? ` · ${escapeHtml(roleMarathi(reporter.role))}` : ''}</span></h3><p>${escapeHtml(reporter.email)}${reporter.phone ? ` · ${escapeHtml(reporter.phone)}` : ''}</p><small>${escapeHtml([reporter.district, reporter.beat].filter(Boolean).join(' · ') || 'No district or beat assigned')} · Last filing ${escapeHtml(dateTime(reporter.last_filed_at))}</small></div>
    <div class="reporter-counts">${Number(reporter.story_count) ? `<span><b>${Number(reporter.story_count)}</b> filed</span><span><b>${Number(reporter.pending_count) || 0}</b> awaiting review</span>` : '<span class="muted">No filings</span>'}</div>
    <div class="reporter-row-actions"><span class="status-pill ${reporter.is_active ? 'approved' : 'rejected'}">${reporter.is_active ? 'Active' : 'Blocked'}</span><button class="btn-secondary" type="button" data-open-reporter="${reporter.id}">Profile</button></div>
  </article>`;
}

function reviewerStory(story) {
  const canReview = ['draft', 'pending', 'rejected'].includes(story.status);
  return `<article class="reporter-story"><div><h4>${escapeHtml(story.title)}</h4><p>${escapeHtml(story.subheading || '')}</p><small>${escapeHtml(story.category || 'Uncategorised')} · ${escapeHtml(story.location || 'No location')} · ${escapeHtml(dateTime(story.updated_at || story.created_at))}</small>${story.review_note ? `<p class="review-note"><b>Review note:</b> ${escapeHtml(story.review_note)}</p>` : ''}</div><div class="reporter-story-actions"><span class="status-pill ${escapeHtml(story.status || 'draft')}">${escapeHtml(story.status || 'draft')}</span>${canReview ? `<button class="btn-secondary" type="button" data-review-story="${story.id}" data-review-status="approved">Approve</button><button class="btn-secondary reporter-reject" type="button" data-review-story="${story.id}" data-review-status="rejected">Reject</button>` : ''}</div></article>`;
}

export async function renderReporterManagement(host, { rightPanel } = {}) {
  if (rightPanel) rightPanel.innerHTML = '<h3>Staff</h3><p>Every login on this paper, and what each of them may do. Blocking takes effect on the account\'s very next request - an open session included - and keeps their work and review history.</p>';
  host.innerHTML = '<div class="form-section"><h2>Staff</h2><p class="muted">Loading the paper\'s logins…</p></div>';
  let reporters;
  try {
    await loadRoles();
    const response = await fetch('/api/staff');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    reporters = await response.json();
  } catch (error) {
    console.error('Staff list failed:', error);
    host.innerHTML = '<div class="form-section"><h2>Staff</h2><p>The paper\'s logins could not be loaded.</p></div>';
    return;
  }

  // What each role is for, in the owner's own words, above the list. The owner
  // hands these out perhaps twice a year; a role whose powers are only
  // discoverable by trying it is a role that gets handed out wrongly.
  const legend = ROLES.map((role) => `<li><span class="role-pill role-${escapeHtml(role.key)}">${escapeHtml(role.label)}</span> <b>${escapeHtml(role.marathi)}</b> — ${escapeHtml(role.describes)}</li>`).join('');

  host.innerHTML = `<div class="form-section reporter-admin">
    <div class="reporter-admin-heading"><div><h2>Staff</h2><p>Every login on this paper. Only the owner can see this screen, add an account, change a role or block one.</p></div><button class="btn-submit" type="button" data-add-reporter>Add login</button></div>
    <details class="role-legend"><summary>What each role may do</summary><ul>${legend}</ul></details>
    <label class="reporter-search"><span>Search staff</span><input type="search" placeholder="Name, email, district, beat or role…" data-reporter-search></label>
    <div class="role-filter" data-role-filter><button type="button" class="active" data-role-pick="">Everyone</button>${ROLES.map((role) => `<button type="button" data-role-pick="${escapeHtml(role.key)}">${escapeHtml(role.label)}</button>`).join('')}</div>
    <div class="reporter-list" data-reporter-list>${reporters.map(reporterRow).join('') || '<p class="muted">No logins have been added yet.</p>'}</div>
  </div>`;

  const search = host.querySelector('[data-reporter-search]');
  const rows = [...host.querySelectorAll('[data-reporter-row]')];
  let pickedRole = '';
  const applyFilters = () => {
    const query = search.value.trim().toLocaleLowerCase();
    rows.forEach((row) => {
      const matchesText = !query || row.dataset.search.includes(query);
      const matchesRole = !pickedRole || row.dataset.role === pickedRole;
      row.hidden = !(matchesText && matchesRole);
    });
  };
  search.addEventListener('input', applyFilters);
  host.querySelectorAll('[data-role-pick]').forEach((button) => button.addEventListener('click', () => {
    pickedRole = button.dataset.rolePick;
    host.querySelectorAll('[data-role-pick]').forEach((other) => other.classList.toggle('active', other === button));
    applyFilters();
  }));
  host.querySelector('[data-add-reporter]').addEventListener('click', () => renderReporterForm(host, { rightPanel, onSaved: () => renderReporterManagement(host, { rightPanel }) }));
  host.querySelectorAll('[data-open-reporter]').forEach((button) => button.addEventListener('click', () => renderReporterProfile(host, Number(button.dataset.openReporter), { rightPanel, onBack: () => renderReporterManagement(host, { rightPanel }) })));
}

function roleFieldMarkup(current) {
  // The description travels with the choice, because an owner picking a role
  // for a new colleague is deciding what that person can do to the paper - and
  // that is not knowable from the word "Editor" alone.
  const options = ROLES.map((role) => `<option value="${escapeHtml(role.key)}"${role.key === (current || 'reporter') ? ' selected' : ''}>${escapeHtml(role.label)} · ${escapeHtml(role.marathi)}</option>`).join('');
  const notes = ROLES.map((role) => `<small class="role-note" data-role-note="${escapeHtml(role.key)}"${role.key === (current || 'reporter') ? '' : ' hidden'}>${escapeHtml(role.describes)}</small>`).join('');
  return `<label class="form-group">Role *<select name="role" data-role-select>${options}</select>${notes}</label>`;
}

function bindRoleField(host) {
  const select = host.querySelector('[data-role-select]');
  if (!select) return;
  select.addEventListener('change', () => {
    host.querySelectorAll('[data-role-note]').forEach((note) => {
      note.hidden = note.dataset.roleNote !== select.value;
    });
  });
}

function renderReporterForm(host, { rightPanel, reporter = null, onSaved }) {
  if (rightPanel) rightPanel.innerHTML = `<h3>${reporter ? 'Edit login' : 'New login'}</h3><p>${reporter ? 'Update the role, contact and coverage details. Blocking is on the profile.' : 'The owner sets the initial sign-in password. Share it privately and ask them to change it after their first sign-in.'}</p>`;
  host.innerHTML = `<div class="form-section reporter-form"><div class="reporter-admin-heading"><div><h2>${reporter ? 'Edit login' : 'Add login'}</h2><p>Only the newspaper owner can see or change account details.</p></div><button class="btn-secondary" type="button" data-reporter-cancel>Back</button></div>
    <form data-reporter-form><div class="form-row"><label class="form-group">Name *<input name="name" required maxlength="120" value="${escapeHtml(reporter?.name || '')}"></label><label class="form-group">Email *<input type="email" name="email" required maxlength="255" value="${escapeHtml(reporter?.email || '')}"></label></div>
    ${roleFieldMarkup(reporter?.role)}
    ${reporter ? '' : '<label class="form-group">Initial password *<input type="password" name="password" required minlength="8" autocomplete="new-password"><small>At least 8 characters.</small></label>'}
    <div class="form-row"><label class="form-group">Phone<input name="phone" maxlength="40" value="${escapeHtml(reporter?.phone || '')}"></label><label class="form-group">District<input name="district" maxlength="120" value="${escapeHtml(reporter?.district || '')}"></label></div>
    <label class="form-group">Beat / coverage<input name="beat" maxlength="120" placeholder="City, politics, sports…" value="${escapeHtml(reporter?.beat || '')}"></label><label class="form-group">Owner notes<textarea name="notes" maxlength="4000" placeholder="Assignment notes, not published with stories…">${escapeHtml(reporter?.notes || '')}</textarea></label>
    <button class="btn-submit" type="submit">${reporter ? 'Save login' : 'Create login'}</button></form></div>`;
  bindRoleField(host);
  host.querySelector('[data-reporter-cancel]').addEventListener('click', onSaved);
  host.querySelector('[data-reporter-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    button.disabled = true;
    const response = await fetch(reporter ? `/api/staff/${reporter.id}` : '/api/staff', { method: reporter ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { button.disabled = false; return window.alert(result.error || 'That login could not be saved.'); }
    onSaved();
  });
}

async function renderReporterProfile(host, id, { rightPanel, onBack }) {
  host.innerHTML = '<div class="form-section"><p class="muted">Loading profile…</p></div>';
  await loadRoles();
  const response = await fetch(`/api/staff/${id}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { host.innerHTML = '<div class="form-section"><p>That profile could not be loaded.</p></div>'; return; }
  // `reporter` is the same row as `person`; the service returns both so this
  // screen and the existing test read the key each already used.
  const { reporter, stories } = data;
  if (rightPanel) rightPanel.innerHTML = `<h3>${escapeHtml(reporter.name)}</h3><p>${reporter.is_active ? 'Account can sign in and file stories.' : 'Account is blocked and cannot sign in or file stories.'}</p><p><b>${stories.length}</b> stories are retained in this reporter’s record.</p>`;
  host.innerHTML = `<div class="form-section reporter-profile"><div class="reporter-admin-heading"><div><h2>${escapeHtml(reporter.name)} <span class="role-pill role-${escapeHtml(reporter.role)}">${escapeHtml(roleLabel(reporter.role))}</span></h2><p>${escapeHtml(reporter.email)} · joined ${escapeHtml(dateTime(reporter.created_at))}</p></div><button class="btn-secondary" type="button" data-reporter-back>Back to staff</button></div>
    <div class="reporter-profile-grid"><div><h3>Account details</h3><dl><dt>Role</dt><dd>${escapeHtml(roleLabel(reporter.role))} · ${escapeHtml(roleMarathi(reporter.role))}<br><small class="muted">${escapeHtml(ROLES.find((r) => r.key === reporter.role)?.describes || '')}</small></dd><dt>Phone</dt><dd>${escapeHtml(reporter.phone || '—')}</dd><dt>District</dt><dd>${escapeHtml(reporter.district || '—')}</dd><dt>Beat</dt><dd>${escapeHtml(reporter.beat || '—')}</dd><dt>Owner notes</dt><dd>${escapeHtml(reporter.notes || '—')}</dd></dl><div class="reporter-profile-controls"><button class="btn-secondary" type="button" data-edit-reporter>Edit details</button><button class="btn-secondary ${reporter.is_active ? 'reporter-reject' : ''}" type="button" data-reporter-access>${reporter.is_active ? 'Block this login' : 'Restore this login'}</button></div></div><div><h3>Filing record</h3><div class="reporter-stories">${stories.map(reviewerStory).join('') || '<p class="muted">No news filed yet.</p>'}</div></div></div>
  </div>`;
  host.querySelector('[data-reporter-back]').addEventListener('click', onBack);
  host.querySelector('[data-edit-reporter]').addEventListener('click', () => renderReporterForm(host, { rightPanel, reporter, onSaved: () => renderReporterProfile(host, id, { rightPanel, onBack }) }));
  host.querySelector('[data-reporter-access]').addEventListener('click', async () => {
    const active = !reporter.is_active;
    if (!window.confirm(active
      ? `Restore ${reporter.name}'s login as ${roleLabel(reporter.role)}?`
      : `Block ${reporter.name} (${roleLabel(reporter.role)})? Their work stays exactly where it is, and they cannot sign in - an open session included, from their next request.`)) return;
    const save = await fetch(`/api/staff/${id}/access`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) });
    // The server refuses two blocks by name - your own login, and the paper's
    // last owner - so its sentence is what the owner needs to read, not a
    // generic one written here.
    const outcome = await save.json().catch(() => ({}));
    if (!save.ok) return window.alert(outcome.error || 'That login could not be changed.');
    renderReporterProfile(host, id, { rightPanel, onBack });
  });
  host.querySelectorAll('[data-review-story]').forEach((button) => button.addEventListener('click', async () => {
    const status = button.dataset.reviewStatus;
    const reviewNote = status === 'rejected' ? window.prompt('Tell the reporter what needs correction (optional):', '') : '';
    if (reviewNote === null) return;
    button.disabled = true;
    const save = await fetch(`/api/news/${button.dataset.reviewStory}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, reviewNote }) });
    const outcome = await save.json().catch(() => ({}));
    if (!save.ok) { button.disabled = false; return window.alert(outcome.error || 'That review could not be saved.'); }
    renderReporterProfile(host, id, { rightPanel, onBack });
  }));
}

import { escapeHtml } from '../editor/format.js';
// The place catalogue, so a district the retrieval could never match cannot
// be stored - never a second list of these names here.
import { STATES } from '../editor/layout/places.js';

export async function renderGeneralSettings(host, { rightPanel } = {}) {
  if (rightPanel) rightPanel.innerHTML = '<h3>General settings</h3><p>These are the durable publication identity and contact details. Saved values feed the newspaper masthead furniture, folios, e-paper metadata and press file. Registered nameplate artwork and legal registration stay protected.</p>';
  host.innerHTML = '<div class="form-section"><h2>Settings</h2><p class="muted">Loading publication settings…</p></div>';
  let settings;
  try {
    const response = await fetch('/api/settings/general');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    settings = await response.json();
  } catch (error) {
    console.error('General settings failed:', error);
    host.innerHTML = '<div class="form-section"><h2>Settings</h2><p>Settings could not be loaded.</p></div>';
    return;
  }
  host.innerHTML = `<div class="form-section general-settings"><div class="settings-heading"><div><h2>General settings</h2><p>Publication identity, contact details and editorial defaults. Open editions pick up these shared details after refresh.</p></div></div>
    <form data-general-settings><section><h3>Publication</h3><label class="form-group">Publication name *<input name="publicationName" required maxlength="200" value="${escapeHtml(settings.publication_name || '')}"></label><label class="form-group">Publisher / owner name<input name="publisherName" maxlength="200" value="${escapeHtml(settings.publisher_name || '')}"></label><label class="form-group">Office address<textarea name="address" maxlength="4000">${escapeHtml(settings.address || '')}</textarea></label></section>
    <section><h3>Contact</h3><div class="form-row"><label class="form-group">Contact email<input type="email" name="contactEmail" maxlength="255" value="${escapeHtml(settings.contact_email || '')}"></label><label class="form-group">Contact phone<input name="contactPhone" maxlength="40" value="${escapeHtml(settings.contact_phone || '')}"></label></div><label class="form-group">Public website<input type="url" name="publicWebsite" placeholder="https://example.com" maxlength="255" value="${escapeHtml(settings.public_website || '')}"></label></section>
    <section><h3>Newsroom defaults</h3><div class="form-row"><label class="form-group">Timezone<select name="timezone"><option value="Asia/Kolkata" ${settings.timezone === 'Asia/Kolkata' ? 'selected' : ''}>India — Asia/Kolkata</option><option value="UTC" ${settings.timezone === 'UTC' ? 'selected' : ''}>UTC</option></select></label><label class="form-group">Default writing language<select name="defaultLanguage"><option value="mr" ${settings.default_language === 'mr' ? 'selected' : ''}>Marathi</option><option value="hi" ${settings.default_language === 'hi' ? 'selected' : ''}>Hindi</option><option value="en" ${settings.default_language === 'en' ? 'selected' : ''}>English</option></select></label></div><div class="form-row"><label class="form-group">State<select name="coverageState">${STATES.map((st) => `<option value="${st.key}" ${settings.coverage_state === st.key ? 'selected' : ''}>${escapeHtml(st.name)} — ${escapeHtml(st.marathi)}</option>`).join('')}</select></label><label class="form-group">District<input name="coverageDistrict" maxlength="80" value="${escapeHtml(settings.coverage_district || '')}" placeholder="Satara"></label><label class="form-group">City or taluka<input name="coverageCity" maxlength="80" value="${escapeHtml(settings.coverage_city || '')}" placeholder="Optional"></label></div><p class="muted">The ground this paper covers. It is never printed — it is what the Newsdesk Run opens on, so "write empty blocks" asks about this district rather than about the town the office is in. A desk can change it for one run without changing this.</p><p class="muted">Changes save as one validated record. Existing editions are never silently renamed, redated or reformatted.</p></section><button class="btn-submit" type="submit">Save settings</button><span class="settings-saved" data-settings-saved aria-live="polite"></span></form></div>`;
  host.querySelector('[data-general-settings]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const saved = host.querySelector('[data-settings-saved]');
    button.disabled = true;
    const response = await fetch('/api/settings/general', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    const result = await response.json().catch(() => ({}));
    button.disabled = false;
    if (!response.ok) { saved.textContent = result.error || 'Settings could not be saved.'; saved.className = 'settings-saved settings-saved--error'; return; }
    saved.textContent = 'Saved.';
    saved.className = 'settings-saved settings-saved--ok';
  });
}

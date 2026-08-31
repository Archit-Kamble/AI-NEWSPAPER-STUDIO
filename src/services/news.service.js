const newsRepository = require('../repositories/news.repository');
const { normalizeStoryMetadata } = require('./storyType.service');

const VALID_STATUSES = ['draft', 'pending', 'approved', 'rejected'];
const REPORTER_STATUSES = new Set(['draft', 'pending']);
const isReporter = (user) => user?.role === 'reporter';

function buildImageUrls(files) {
  return Array.isArray(files) ? files.map((file) => `/uploads/${file.filename}`) : [];
}

async function createNews({ body, files, sessionUser }) {
  if (!body.title) {
    return { error: 'Title required' };
  }
  const semantic = await normalizeStoryMetadata(body, {
    storyType: 'STANDARD',
    editorialPriority: 3,
  });
  if (semantic.error) return semantic;

  const requestedStatus = body.status || 'draft';
  if (isReporter(sessionUser) && !REPORTER_STATUSES.has(requestedStatus)) {
    return { error: 'Reporters can save a draft or submit it for review.' };
  }
  const item = await newsRepository.create({
    newspaper_id: Number.isInteger(Number(body.newspaperId)) ? Number(body.newspaperId) : null,
    title: body.title || '',
    subheading: body.subheading || body.subtitle || '',
    description: body.description || '',
    category: body.category || '',
    location: body.location || '',
    city: body.city || '',
    tags: body.tags || '',
    reporter_name: isReporter(sessionUser) ? sessionUser.name : body.reporterName || sessionUser?.name || '',
    story_type: semantic.storyType,
    editorial_priority: semantic.editorialPriority,
    desired_page_role: body.desiredPageRole || body.desired_page_role || null,
    image_urls: buildImageUrls(files),
    status: requestedStatus,
    created_by: sessionUser?.id || null,
  });

  return { item };
}

/**
 * A DRAFT IS THE REPORTER'S OWN, AND NOBODY ELSE'S.
 *
 * `draft` and `pending` are the two states a reporter may save into
 * (REPORTER_STATUSES above): a draft is a story still being written, and
 * `pending` is the act of handing it to the desk. This list made no
 * distinction, so every unfinished sentence a reporter had ever saved sat in
 * the desk's review queue beside the stories that had actually been filed -
 * measured on this newsroom's database, and the desk's report was exactly
 * that.
 *
 * It is not only noise. The Take-from-Reporter picker reads this same list, so
 * a sub-editor could place a story into page one that its author had never
 * submitted, and the reporter would find their unfinished copy in print.
 *
 * So: a reporter sees their OWN drafts, which is their inbox and the whole
 * point of a draft. Everybody else sees what has been filed. An explicit
 * `?status=draft` is still honoured - the query is a question about a state,
 * and a desk that asks for drafts by name is not being surprised by them.
 */
async function listNews(query, sessionUser) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.language) filter.language = query.language;
  // A reporter's byline is not authorization. Their session id is the sole
  // source of their inbox, so changing ?reporterId cannot expose a colleague.
  if (isReporter(sessionUser)) filter.created_by = sessionUser.id;
  else {
    if (query.reporterId) filter.created_by = parseInt(query.reporterId, 10);
    if (!query.status) filter.excludeStatuses = ['draft'];
  }
  return newsRepository.findAll(filter);
}

async function getNewsByStatus(status) {
  return newsRepository.findByStatus(status);
}

async function getNews(id, sessionUser) {
  const item = await newsRepository.findById(parseInt(id, 10));
  if (!item) return { notFound: true };
  if (isReporter(sessionUser) && Number(item.created_by) !== Number(sessionUser.id)) return { forbidden: true };
  return { item };
}

async function updateNews(id, { body, files, sessionUser }) {
  const existing = await newsRepository.findById(parseInt(id, 10));
  if (!existing) return { notFound: true };
  if (isReporter(sessionUser) && Number(existing.created_by) !== Number(sessionUser.id)) return { forbidden: true };
  if (isReporter(sessionUser) && existing.status === 'approved') return { error: 'Approved copy is locked for the desk. File a follow-up if it needs correction.' };
  const requestedStatus = body.status || 'draft';
  if (isReporter(sessionUser) && !REPORTER_STATUSES.has(requestedStatus)) {
    return { error: 'Reporters can save a draft or submit it for review.' };
  }
  const semantic = await normalizeStoryMetadata(body, {
    storyType: existing.story_type,
    editorialPriority: existing.editorial_priority,
  });
  if (semantic.error) return semantic;

  const updates = {
    newspaper_id: existing.newspaper_id,
    title: body.title,
    subheading: body.subheading || body.subtitle || '',
    description: body.description || '',
    category: body.category || '',
    location: body.location || '',
    city: body.city || '',
    tags: body.tags || '',
    reporter_name: isReporter(sessionUser) ? sessionUser.name : body.reporterName || existing.reporter_name || '',
    story_type: semantic.storyType,
    editorial_priority: semantic.editorialPriority,
    desired_page_role: body.desiredPageRole || body.desired_page_role || existing.desired_page_role || null,
    image_urls: existing.image_urls || [],
    status: requestedStatus,
    created_by: existing.created_by,
  };

  if (files && files.length) {
    updates.image_urls = buildImageUrls(files);
  }

  const item = await newsRepository.update(parseInt(id, 10), updates);
  if (!item) return { notFound: true };
  return { item };
}

async function updateNewsStatus(id, status, { reviewerId, reviewNote } = {}) {
  if (!VALID_STATUSES.includes(status)) {
    return { error: 'Invalid news status' };
  }

  const existing = await newsRepository.findById(parseInt(id, 10));
  if (!existing) return { notFound: true };

  const item = await newsRepository.setStatus(parseInt(id, 10), { status, reviewerId, reviewNote });
  if (!item) return { notFound: true };
  return { item };
}

module.exports = {
  createNews,
  listNews,
  getNewsByStatus,
  getNews,
  updateNews,
  updateNewsStatus,
};

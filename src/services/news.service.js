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

async function listNews(query, sessionUser) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.language) filter.language = query.language;
  // A reporter's byline is not authorization. Their session id is the sole
  // source of their inbox, so changing ?reporterId cannot expose a colleague.
  if (isReporter(sessionUser)) filter.created_by = sessionUser.id;
  else if (query.reporterId) filter.created_by = parseInt(query.reporterId, 10);
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

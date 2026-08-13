const newsRepository = require('../repositories/news.repository');
const { normalizeStoryMetadata } = require('./storyType.service');

const VALID_STATUSES = ['draft', 'pending', 'approved', 'rejected'];

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

  const item = await newsRepository.create({
    newspaper_id: Number.isInteger(Number(body.newspaperId)) ? Number(body.newspaperId) : null,
    title: body.title || '',
    subheading: body.subheading || body.subtitle || '',
    description: body.description || '',
    category: body.category || '',
    location: body.location || '',
    city: body.city || '',
    tags: body.tags || '',
    reporter_name: body.reporterName || sessionUser?.name || '',
    story_type: semantic.storyType,
    editorial_priority: semantic.editorialPriority,
    desired_page_role: body.desiredPageRole || body.desired_page_role || null,
    image_urls: buildImageUrls(files),
    status: body.status || 'draft',
    created_by: sessionUser?.id || Number.parseInt(body.reporterId, 10) || null,
  });

  return { item };
}

async function listNews(query) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.language) filter.language = query.language;
  if (query.reporterId) filter.created_by = parseInt(query.reporterId, 10);
  return newsRepository.findAll(filter);
}

async function getNewsByStatus(status) {
  return newsRepository.findByStatus(status);
}

async function getNews(id) {
  return newsRepository.findById(parseInt(id, 10));
}

async function updateNews(id, { body, files }) {
  const existing = await newsRepository.findById(parseInt(id, 10));
  if (!existing) return { notFound: true };
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
    reporter_name: body.reporterName || '',
    story_type: semantic.storyType,
    editorial_priority: semantic.editorialPriority,
    desired_page_role: body.desiredPageRole || body.desired_page_role || existing.desired_page_role || null,
    image_urls: existing.image_urls || [],
    status: body.status || 'draft',
    created_by: existing.created_by,
  };

  if (files && files.length) {
    updates.image_urls = buildImageUrls(files);
  }

  const item = await newsRepository.update(parseInt(id, 10), updates);
  if (!item) return { notFound: true };
  return { item };
}

async function updateNewsStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    return { error: 'Invalid news status' };
  }

  const existing = await newsRepository.findById(parseInt(id, 10));
  if (!existing) return { notFound: true };

  const item = await newsRepository.update(parseInt(id, 10), { ...existing, status });
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

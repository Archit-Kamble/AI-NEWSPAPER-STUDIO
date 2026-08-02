const newsRepository = require('../repositories/news.repository');

const VALID_STATUSES = ['draft', 'pending', 'approved', 'rejected'];

function buildImageUrls(files) {
  return Array.isArray(files) ? files.map((file) => `/uploads/${file.filename}`) : [];
}

async function createNews({ body, files, sessionUser }) {
  if (!body.title) {
    return { error: 'Title required' };
  }

  const item = await newsRepository.create({
    newspaper_id: null,
    title: body.title || '',
    subheading: body.subheading || body.subtitle || '',
    description: body.description || '',
    category: body.category || '',
    location: body.location || '',
    city: body.city || '',
    tags: body.tags || '',
    reporter_name: body.reporterName || sessionUser?.name || '',
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

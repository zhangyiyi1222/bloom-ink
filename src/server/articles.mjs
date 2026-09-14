import crypto from 'node:crypto';
import { all, get, run, tx, nowIso } from './db.mjs';
import { countWords, excerptFrom } from './markdown.mjs';
import { indexArticle, removeFromIndex } from './search.mjs';
import { sectionName, SECTION_KEYS } from './config.mjs';

export const STATUS = { draft: 'draft', published: 'published', scheduled: 'scheduled' };
const MAX_REVISIONS = 30;

/** 文章 URL 段：保留中文（可读、可迁移），只清掉不安全字符。 */
export function slugify(input) {
  const text = String(input || '').trim().toLowerCase();
  const slug = text
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  if (slug) return slug;
  return `post-${crypto.randomBytes(3).toString('hex')}`;
}

export function normalizeSection(section) {
  const value = String(section || '').trim().toLowerCase();
  return SECTION_KEYS.includes(value) ? value : null;
}

export function normalizeTags(tags) {
  const list = Array.isArray(tags)
    ? tags
    : String(tags || '')
        .split(/[,，\s]+/)
        .filter(Boolean);
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))].slice(0, 12).join(',');
}

function computePermalink(section, slug) {
  return `/${section}/${slug}/`;
}

function toDateInput(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isPubliclyVisible(row, at = new Date()) {
  if (!row || row.deleted_at) return false;
  if (row.status === STATUS.published) return true;
  if (row.status === STATUS.scheduled && row.published_at && new Date(row.published_at) <= at) return true;
  return false;
}

export function getArticle(id, { includeDeleted = true } = {}) {
  const row = get(
    `SELECT * FROM articles WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
    id
  );
  return row || null;
}

export function getArticleBySlug(section, slug) {
  return (
    get(
      'SELECT * FROM articles WHERE section = ? AND slug = ? AND deleted_at IS NULL',
      section,
      slug
    ) || null
  );
}

export function getArticleByDateSlug(section, year, month, slug) {
  return (
    get(
      `SELECT * FROM articles
       WHERE section = ? AND slug = ? AND deleted_at IS NULL
         AND substr(published_at, 1, 4) = ? AND substr(published_at, 6, 2) = ?`,
      section,
      slug,
      String(year).padStart(4, '0'),
      String(month).padStart(2, '0')
    ) || null
  );
}

export function listArticles({
  section = '',
  status = '',
  q = '',
  tag = '',
  trash = false,
  limit = 50,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];
  where.push(trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');
  if (section) {
    where.push('section = ?');
    params.push(section);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (tag) {
    where.push("(',' || tags || ',') LIKE ?");
    params.push(`%,${tag},%`);
  }
  if (q) {
    where.push('(title LIKE ? OR content LIKE ? OR slug LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT id, title, slug, section, status, published_at, permalink, tags, word_count,
            created_at, updated_at, deleted_at, substr(content, 1, 200) AS content_head
     FROM articles ${clause}
     ORDER BY COALESCE(published_at, created_at) DESC, id DESC
     LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  const total = get(`SELECT COUNT(*) AS n FROM articles ${clause}`, ...params).n;
  return { rows, total };
}

export function createArticle(input = {}) {
  const section = normalizeSection(input.section) || 'log';
  let slug = slugify(input.slug || input.title || '');
  slug = uniqueSlug(section, slug);
  const ts = nowIso();
  const publishedAt = toDateInput(input.published_at) || ts;
  const status = STATUS[input.status] || STATUS.draft;
  const content = String(input.content || '');
  const info = run(
    `INSERT INTO articles
      (title, slug, section, content, content_format, status, published_at, permalink,
       seo_description, tags, word_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?, ?, ?, ?)`,
    String(input.title || ''),
    slug,
    section,
    content,
    status,
    publishedAt,
    computePermalink(section, slug),
    String(input.seo_description || ''),
    normalizeTags(input.tags),
    countWords(content),
    ts,
    ts
  );
  const article = getArticle(Number(info.lastInsertRowid));
  snapshot(article);
  if (isPubliclyVisible(article)) indexArticle(article);
  return article;
}

function uniqueSlug(section, slug) {
  let candidate = slug;
  let n = 2;
  while (get('SELECT id FROM articles WHERE section = ? AND slug = ? AND deleted_at IS NULL', section, candidate)) {
    candidate = `${slug}-${n}`;
    n += 1;
    if (n > 999) {
      candidate = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
      break;
    }
  }
  return candidate;
}

export function updateArticle(id, patch = {}) {
  const current = getArticle(id);
  if (!current) return null;
  const title = patch.title === undefined ? current.title : String(patch.title);
  const content = patch.content === undefined ? current.content : String(patch.content);
  const section = patch.section === undefined ? current.section : normalizeSection(patch.section) || current.section;
  let slug = patch.slug === undefined ? current.slug : slugify(patch.slug);
  if (slug !== current.slug || section !== current.section) {
    slug = uniqueSlug(section, slug);
  }
  const status = patch.status === undefined ? current.status : STATUS[patch.status] || current.status;
  const publishedAt =
    patch.published_at === undefined ? current.published_at : toDateInput(patch.published_at) || current.published_at;
  const tags = patch.tags === undefined ? current.tags : normalizeTags(patch.tags);
  const seo = patch.seo_description === undefined ? current.seo_description : String(patch.seo_description || '');

  const before = `${current.title}\u0000${current.content}\u0000${current.seo_description || ''}`;
  const after = `${title}\u0000${content}\u0000${seo}`;
  if (before !== after) snapshot(current);

  const permalink = computePermalink(section, slug);
  run(
    `UPDATE articles SET title = ?, slug = ?, section = ?, content = ?, status = ?, published_at = ?,
       permalink = ?, seo_description = ?, tags = ?, word_count = ?, updated_at = ?
     WHERE id = ?`,
    title,
    slug,
    section,
    content,
    status,
    publishedAt,
    permalink,
    seo,
    tags,
    countWords(content),
    nowIso(),
    id
  );
  const article = getArticle(id);
  if (isPubliclyVisible(article)) indexArticle(article);
  else removeFromIndex(id);
  return article;
}

export function setStatus(id, status, publishedAt) {
  const value = STATUS[status];
  if (!value) return null;
  const current = getArticle(id);
  if (!current) return null;
  const when = publishedAt ? toDateInput(publishedAt) : current.published_at || nowIso();
  run(
    'UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?',
    value,
    when,
    nowIso(),
    id
  );
  const article = getArticle(id);
  if (isPubliclyVisible(article)) indexArticle(article);
  else removeFromIndex(id);
  return article;
}

export function deleteArticle(id) {
  const article = getArticle(id);
  if (!article) return null;
  run('UPDATE articles SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
  removeFromIndex(id);
  return getArticle(id);
}

export function restoreArticle(id) {
  const article = getArticle(id);
  if (!article) return null;
  run('UPDATE articles SET deleted_at = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
  const restored = getArticle(id);
  if (isPubliclyVisible(restored)) indexArticle(restored);
  return restored;
}

export function purgeArticle(id) {
  const article = getArticle(id);
  if (!article) return null;
  tx(() => {
    run('DELETE FROM article_revisions WHERE article_id = ?', id);
    run('DELETE FROM search_index WHERE article_id = ?', id);
    run('DELETE FROM articles WHERE id = ?', id);
  });
  return article;
}

/* ------------------------------ 版本历史 ------------------------------ */

function snapshot(article) {
  if (!article) return;
  const last = get(
    'SELECT * FROM article_revisions WHERE article_id = ? ORDER BY id DESC LIMIT 1',
    article.id
  );
  if (last && last.content === article.content && last.title === article.title && last.seo_description === (article.seo_description || '')) {
    return;
  }
  run(
    `INSERT INTO article_revisions
      (article_id, title, content, seo_description, tags, status, published_at, word_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    article.id,
    article.title,
    article.content,
    article.seo_description || '',
    article.tags || '',
    article.status,
    article.published_at,
    article.word_count || 0,
    nowIso()
  );
  const extra = all(
    'SELECT id FROM article_revisions WHERE article_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?',
    article.id,
    MAX_REVISIONS
  );
  for (const row of extra) run('DELETE FROM article_revisions WHERE id = ?', row.id);
}

export function listRevisions(articleId) {
  return all(
    `SELECT id, article_id, title, seo_description, status, published_at, word_count, created_at,
            length(content) AS content_length
     FROM article_revisions WHERE article_id = ? ORDER BY id DESC LIMIT 40`,
    articleId
  );
}

export function getRevision(id) {
  return get('SELECT * FROM article_revisions WHERE id = ?', id) || null;
}

export function restoreRevision(articleId, revisionId) {
  const revision = getRevision(revisionId);
  if (!revision || revision.article_id !== articleId) return null;
  const current = getArticle(articleId);
  snapshot(current);
  run(
    `UPDATE articles SET title = ?, content = ?, seo_description = ?, tags = ?, word_count = ?, updated_at = ?
     WHERE id = ?`,
    revision.title,
    revision.content,
    revision.seo_description || '',
    revision.tags || current.tags,
    revision.word_count || countWords(revision.content),
    nowIso(),
    articleId
  );
  const article = getArticle(articleId);
  if (isPubliclyVisible(article)) indexArticle(article);
  return article;
}

/* ------------------------------ 归档与统计 ------------------------------ */

const publicClause = `deleted_at IS NULL AND (
  status = 'published' OR (status = 'scheduled' AND published_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`;

/**
 * 归档树：年 → 月 → 条目，供四个栏目共用的 Article Archive 组件使用。
 */
export function archiveTree({ section, limit = 3000 } = {}) {
  const params = [];
  let sql = `SELECT id, title, slug, section, published_at, permalink, status, updated_at
     FROM articles WHERE ${publicClause}`;
  if (section) {
    sql += ' AND section = ?';
    params.push(section);
  }
  sql += ' ORDER BY published_at DESC, id DESC LIMIT ?';
  params.push(limit);
  const rows = all(sql, ...params);

  const years = new Map();
  for (const row of rows) {
    const date = new Date(row.published_at);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push({
      id: row.id,
      title: row.title || '(无标题)',
      slug: row.slug,
      section: row.section,
      day: date.getDate(),
      month,
      year,
      datetime: row.published_at,
      permalink: row.permalink || `/${row.section}/${row.slug}/`,
      dateLabel: `${month}月${date.getDate()}日`,
    });
  }
  return [...years.entries()].map(([year, months]) => ({
    year,
    months: [...months.entries()].map(([month, items]) => ({ month, items })),
  }));
}

export function articleStats() {
  const rows = all(
    `SELECT section, status, COUNT(*) AS n FROM articles WHERE deleted_at IS NULL GROUP BY section, status`
  );
  const trash = get('SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NOT NULL').n;
  const total = get('SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NULL').n;
  const words = get('SELECT COALESCE(SUM(word_count),0) AS n FROM articles WHERE deleted_at IS NULL').n;
  return { bySection: rows, trash, total, words };
}

export function neighbors(article) {
  if (!article) return { prev: null, next: null };
  const order = `ORDER BY published_at DESC, id DESC`;
  const prev =
    get(
      `SELECT id, title, slug, section, permalink, published_at FROM articles
       WHERE ${publicClause} AND (published_at, id) < (?, ?) ${order} LIMIT 1`,
      article.published_at,
      article.id
    ) || null;
  const next =
    get(
      `SELECT id, title, slug, section, permalink, published_at FROM articles
       WHERE ${publicClause} AND (published_at, id) > (?, ?)
       ORDER BY published_at ASC, id ASC LIMIT 1`,
      article.published_at,
      article.id
    ) || null;
  return { prev, next };
}

export function recentArticleIds(limit = 5) {
  return all(
    `SELECT id, title, permalink, published_at, section FROM articles WHERE ${publicClause} ORDER BY published_at DESC, id DESC LIMIT ?`,
    limit
  );
}

export function sectionCounts() {
  const map = {};
  for (const key of SECTION_KEYS) map[key] = { key, name: sectionName(key), total: 0, latest: null };
  for (const row of all(
    `SELECT section, COUNT(*) AS n, MAX(published_at) AS latest FROM articles WHERE ${publicClause} GROUP BY section`
  )) {
    if (map[row.section]) {
      map[row.section].total = row.n;
      map[row.section].latest = row.latest;
    }
  }
  return map;
}

export function articleExcerpt(article, length = 160) {
  if (!article) return '';
  if (article.seo_description) return article.seo_description;
  return excerptFrom(article.content, length);
}

export function snippet(article) {
  return (article?.content || '').slice(0, 200);
}

/* ------------------------------------------------------------------ *
 * permalink 里的 slug 做百分号编码。
 * 中文 slug 当然是可读的，但作为 URL 应该以编码形式输出：
 * sitemap / RSS / canonical / Open Graph 才都是合规的 URI。
 * 浏览器地址栏依然显示中文，链接也照常可点。
 * ------------------------------------------------------------------ */
function computeEncodedPermalink(section, slug) {
  return `/${section}/${encodeURIComponent(slug)}/`;
}
computePermalink = computeEncodedPermalink;

/* ------------------------------------------------------------------ *
 * 草稿的 slug 跟随标题。
 * 新建文章时标题还是「未命名」，如果 slug 就此定下来，每篇文章的 URL 都会
 * 变成一样的默认值。这里只在两种情况下自动同步：
 *   - 还是草稿
 *   - slug 从来没有被手动改过（即 slug 就是标题算出来的那个值）
 * 已经发布过的文章不会因为改标题而改动 URL。
 * ------------------------------------------------------------------ */
const __updateArticleImpl = updateArticle;

updateArticle = function updateArticleWithAutoSlug(id, patch = {}) {
  const current = getArticle(id);
  if (current && patch.title !== undefined && patch.slug !== undefined) {
    const nextTitle = String(patch.title).trim();
    const slugUnchanged = String(patch.slug) === current.slug;
    const autoDerived = current.slug === slugify(current.title) || !String(current.title).trim();
    if (slugUnchanged && autoDerived && nextTitle && current.status === 'draft') {
      return __updateArticleImpl(id, { ...patch, slug: nextTitle });
    }
  }
  return __updateArticleImpl(id, patch);
};

/* 上一版判定太严：slug 可能已经被自动去重成了「未命名-2」。
   这里把“自动派生过”的判定放宽为：slug 就是标题算出来的值，
   或者是它加了去重后缀的形式。手动改成别的 slug 就不会再被覆写。 */
updateArticle = function updateArticleWithAutoSlugV2(id, patch = {}) {
  const current = getArticle(id);
  if (current && patch.title !== undefined && patch.slug !== undefined) {
    const nextTitle = String(patch.title).trim();
    const base = slugify(current.title);
    const slugUnchanged = String(patch.slug) === current.slug;
    const autoDerived =
      current.slug === base || current.slug.startsWith(`${base}-`) || !String(current.title).trim();
    if (slugUnchanged && autoDerived && nextTitle && current.status === 'draft') {
      return __updateArticleImpl(id, { ...patch, slug: nextTitle });
    }
  }
  return __updateArticleImpl(id, patch);
};

import { all, get, run, nowIso } from './db.mjs';
import { markdownToPlainText, excerptFrom } from './markdown.mjs';

/** 搜索索引：文章发布/修改/删除后自动更新，也可在后台手动重建。 */

export function indexArticle(article) {
  if (!article) return;
  if (article.deleted_at || article.status !== 'published') {
    run('DELETE FROM search_index WHERE article_id = ?', article.id);
    return;
  }
  const body = markdownToPlainText(article.content);
  run(
    `INSERT INTO search_index (article_id, title, body, section, slug, date, tags, permalink, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       title = excluded.title, body = excluded.body, section = excluded.section,
       slug = excluded.slug, date = excluded.date, tags = excluded.tags,
       permalink = excluded.permalink, updated_at = excluded.updated_at`,
    article.id,
    article.title || '',
    body,
    article.section,
    article.slug,
    (article.published_at || '').slice(0, 10),
    article.tags || '',
    article.permalink || '',
    nowIso()
  );
}

export function removeFromIndex(articleId) {
  run('DELETE FROM search_index WHERE article_id = ?', articleId);
}

export function rebuildIndex() {
  run('DELETE FROM search_index');
  const rows = all(
    "SELECT * FROM articles WHERE deleted_at IS NULL AND status = 'published' AND published_at <= ?",
    nowIso()
  );
  for (const row of rows) indexArticle(row);
  return rows.length;
}

export function indexStatus() {
  const total = get('SELECT COUNT(*) AS n FROM search_index').n;
  const last = get('SELECT MAX(updated_at) AS ts FROM search_index').ts || null;
  const articles = get(
    "SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NULL AND status = 'published'"
  ).n;
  return { indexed: total, published: articles, lastUpdated: last };
}

/** 给前台的搜索索引文件：紧凑字段名，减少体积。 */
export function searchPayload() {
  const rows = all(
    'SELECT title, body, section, slug, date, permalink, tags FROM search_index ORDER BY date DESC'
  );
  const items = rows.map((row) => ({
    t: row.title,
    p: row.permalink || `/`,
    s: row.section,
    d: row.date,
    x: row.body.length > 4000 ? row.body.slice(0, 4000) : row.body,
  }));
  return { generatedAt: nowIso(), count: items.length, items };
}

export function searchInIndex(query, limit = 40) {
  const q = String(query || '').trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const scored = [];
  for (const row of all('SELECT * FROM search_index')) {
    const haystack = `${row.title} ${row.body} ${row.tags}`.toLowerCase();
    let score = 0;
    let missing = false;
    for (const term of terms) {
      const t = term.toLowerCase();
      if (haystack.includes(t)) {
        score += row.title.toLowerCase().includes(t) ? 8 : 3;
      } else if (row.title.toLowerCase().includes(t.slice(0, Math.max(2, t.length - 1)))) {
        score += 1;
      } else {
        missing = true;
        break;
      }
    }
    if (missing || !score) continue;
    const idx = row.body.toLowerCase().indexOf(terms[0].toLowerCase());
    scored.push({
      ...row,
      score,
      excerpt: excerptFrom(idx > 40 ? row.body.slice(idx - 40) : row.body, 120),
    });
  }
  return scored.sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : -1)).slice(0, limit);
}

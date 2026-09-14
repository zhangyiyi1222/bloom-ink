import express from 'express';
import crypto from 'node:crypto';
import { SECTION_KEYS, sectionOf, sessionSecret } from '../config.mjs';
import { getSettings } from '../settings.mjs';
import {
  archiveTree,
  getArticle,
  getArticleBySlug,
  getArticleByDateSlug,
  isPubliclyVisible,
  neighbors,
  sectionCounts,
  articleExcerpt,
} from '../articles.mjs';
import { renderMarkdown, hasMath, excerptFrom, setDimensionIndex } from '../markdown.mjs';
import { mediaDimensionIndex } from '../media.mjs';
import { searchPayload } from '../search.mjs';
import { baseContext, contextForSection, BLOOM_SECTIONS, ACCENTS } from '../pages.mjs';
import { currentUser } from '../auth.mjs';

export const publicRouter = express.Router();

const TZ = process.env.SITE_TIMEZONE || 'Asia/Shanghai';

function setDimIndex() {
  setDimensionIndex(mediaDimensionIndex());
}

export function formatDate(iso, style = 'long') {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (style === 'iso') {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function createPreviewToken(articleId, ttlMinutes = 180) {
  const exp = Date.now() + ttlMinutes * 60 * 1000;
  const payload = `${articleId}.${exp}`;
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${exp}.${sig}`;
}

export function verifyPreviewToken(articleId, token) {
  if (!token) return false;
  const [expRaw, sig] = String(token).split('.');
  const exp = Number(expRaw);
  if (!exp || !sig || exp < Date.now()) return false;
  const expected = crypto
    .createHmac('sha256', sessionSecret())
    .update(`${articleId}.${exp}`)
    .digest('base64url');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/* ------------------------------- 首页 ------------------------------- */

publicRouter.get('/', (req, res) => {
  setDimIndex();
  const settings = getSettings();
  const tree = archiveTree({ section: 'log' });
  res.render('home', {
    ...baseContext(req, {
      pageKind: 'home',
      pageTitle: `${settings['site.title']} · ${settings['site.name']}`,
      description: settings['site.description'],
      bodyClass: 'page-shell',
      canEdit: Boolean(currentUser(req.cookies?.session)),
      bloomSections: BLOOM_SECTIONS,
      logTree: tree,
      sectionCounts: sectionCounts(),
      navSections: BLOOM_SECTIONS,
    }),
  });
});

/* ---------------------------- 搜索索引与工具 ---------------------------- */

publicRouter.get('/search-index.json', (req, res) => {
  const payload = searchPayload();
  const etag = `W/"idx-${payload.count}-${payload.generatedAt}"`;
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.type('application/json').send(JSON.stringify(payload));
});

publicRouter.get('/robots.txt', (req, res) => {
  const settings = getSettings();
  const domain = (settings['site.domain'] || '').replace(/\/$/, '');
  res
    .type('text/plain')
    .send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /preview',
        `Sitemap: ${domain}/sitemap.xml`,
        '',
      ].join('\n')
    );
});

publicRouter.get('/sitemap.xml', (req, res) => {
  const settings = getSettings();
  const domain = (settings['site.domain'] || '').replace(/\/$/, '');
  const urls = [{ loc: '/', priority: '1.0', changefreq: 'daily' }];
  for (const key of SECTION_KEYS) {
    urls.push({ loc: `/${key}/`, priority: '0.8', changefreq: 'daily' });
  }
  for (const year of archiveTree({ limit: 5000 })) {
    for (const month of year.months) {
      for (const item of month.items) {
        urls.push({
          loc: item.permalink,
          lastmod: item.datetime.slice(0, 10),
          priority: '0.7',
          changefreq: 'monthly',
        });
      }
    }
  }
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) =>
        `  <url><loc>${domain}${u.loc}</loc>${
          u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''
        }<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    ),
    '</urlset>',
  ].join('\n');
  res.type('application/xml').send(body);
});

publicRouter.get('/rss.xml', (req, res) => renderFeed(req, res, null));
publicRouter.get('/log/rss.xml', (req, res) => renderFeed(req, res, 'log'));

function renderFeed(req, res, section) {
  const settings = getSettings();
  const domain = (settings['site.domain'] || '').replace(/\/$/, '');
  const items = [];
  for (const year of archiveTree({ section, limit: 30 })) {
    for (const month of year.months) {
      for (const item of month.items) items.push(item);
      if (items.length >= 30) break;
    }
    if (items.length >= 30) break;
  }

  const entries = items.slice(0, 30).map((item) => {
    const article = getArticle(item.id);
    const html = article ? renderMarkdown(article.content) : '';
    const url = `${domain}${item.permalink}`;
    return [
      '  <item>',
      `    <title>${escapeXml(item.title)}</title>`,
      `    <link>${url}</link>`,
      `    <guid isPermaLink="true">${url}</guid>`,
      `    <pubDate>${new Date(item.datetime).toUTCString()}</pubDate>`,
      `    <description>${escapeXml(article ? articleExcerpt(article, 200) : '')}</description>`,
      `    <content:encoded><![CDATA[${html.replace(/]]>/g, ']]&gt;')}]]></content:encoded>`,
      '  </item>',
    ].join('\n');
  });

  const title = section ? `${settings['site.title']} · 日志` : settings['site.title'];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `  <title>${escapeXml(title)}</title>`,
    `  <link>${domain}${section ? '/log/' : '/'}</link>`,
    `  <description>${escapeXml(settings['site.description'])}</description>`,
    '  <language>zh-CN</language>',
    `  <atom:link href="${domain}${
      section ? '/log/rss.xml' : '/rss.xml'
    }" rel="self" type="application/rss+xml"/>`,
    ...entries,
    '</channel>',
    '</rss>',
  ].join('\n');
  res.type('application/rss+xml').send(body);
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------ 搜索页 ------------------------------ */

publicRouter.get('/search/', (req, res) => {
  const settings = getSettings();
  res.render('home', {
    ...baseContext(req, {
      pageKind: 'home',
      pageTitle: `搜索 · ${settings['site.title']}`,
      bodyClass: 'page-shell open-search',
      bloomSections: BLOOM_SECTIONS,
      logTree: archiveTree({ section: 'log' }),
      sectionCounts: sectionCounts(),
      navSections: BLOOM_SECTIONS,
    }),
  });
});

/* --------------------------- 草稿预览（与前台同一 renderer） --------------------------- */

publicRouter.get('/preview/:id', (req, res, next) => {
  const user = currentUser(req.cookies?.session);
  const id = Number(req.params.id);
  const tokenOk = verifyPreviewToken(id, req.query.token);
  if (!user && !tokenOk) return next();
  const article = getArticle(id);
  if (!article) return next();
  renderArticlePage(req, res, article, { previewMode: true, canEdit: Boolean(user) });
});

/* ------------------------------ 归档页 ------------------------------ */

publicRouter.get('/:section/', (req, res, next) => {
  const key = String(req.params.section || '').toLowerCase();
  if (!SECTION_KEYS.includes(key)) return next();
  const section = sectionOf(key);
  const settings = getSettings();
  const tree = archiveTree({ section: key });
  res.render('archive', {
    ...contextForSection(req, key, {
      pageTitle: `${section.name} · ${settings['site.title']}`,
      description: `${settings['site.title']}的${section.name}${
        section.question ? `：${section.question}` : ''
      }`,
      bodyClass: `page-shell page-shell--${key}`,
      tree,
      section,
      navSections: key === 'log' ? [sectionOf('log')] : BLOOM_SECTIONS,
    }),
  });
});

/* --------------------------- 文章页（稳定 permalink） --------------------------- */

publicRouter.get('/:section/:slug/', (req, res, next) => {
  const key = String(req.params.section || '').toLowerCase();
  if (!SECTION_KEYS.includes(key)) return next();
  const article = getArticleBySlug(key, String(req.params.slug));
  if (!article) return next();
  if (!isPubliclyVisible(article)) {
    const user = currentUser(req.cookies?.session);
    const tokenOk = verifyPreviewToken(article.id, req.query.token);
    if (!user && !tokenOk) return next();
    return renderArticlePage(req, res, article, { previewMode: true, canEdit: Boolean(user) });
  }
  return renderArticlePage(req, res, article, {});
});

/* ------------------- 兼容旧式日期 URL：301 到稳定 permalink ------------------- */

publicRouter.get('/:section/:year/:month/:slug/', (req, res, next) => {
  const key = String(req.params.section || '').toLowerCase();
  if (!SECTION_KEYS.includes(key)) return next();
  if (!/^[0-9]{4}$/.test(req.params.year)) return next();
  if (!/^[0-9]{1,2}$/.test(req.params.month)) return next();
  const article = getArticleByDateSlug(
    key,
    req.params.year,
    req.params.month,
    String(req.params.slug)
  );
  if (!article) return next();
  return res.redirect(301, article.permalink || `/${key}/${article.slug}/`);
});

/* ------------------------------ 文章渲染 ------------------------------ */

function renderArticlePage(req, res, article, { previewMode = false, canEdit = false } = {}) {
  setDimIndex();
  const settings = getSettings();
  const html = renderMarkdown(article.content);
  const nav = neighbors(article);
  res.render('article', {
    ...contextForSection(req, article.section, {
      pageKind: 'article',
      pageTitle: `${article.title} · ${settings['site.title']}`,
      description: article.seo_description || excerptFrom(article.content, 150),
      ogImage: firstImageUrl(article.content) || settings['seo.defaultImage'] || '',
      bodyClass: `page-shell page-shell--${article.section}`,
      hasMath: hasMath(article.content),
      article,
      html,
      previewMode,
      canEdit,
      publishedLabel: formatDate(article.published_at),
      neighbors: nav,
      navSections: article.section === 'log' ? [sectionOf('log')] : BLOOM_SECTIONS,
      activeSection: article.section,
      accent: article.section,
      accentColor: (ACCENTS[article.section] || ACCENTS.bloom).color,
    }),
  });
}

function firstImageUrl(source) {
  const match = String(source || '').match(/!\[[^\]]*\]\(([^)\s]+)/);
  if (!match) return '';
  const url = match[1];
  if (/^https?:\/\//i.test(url)) return url;
  const domain = (getSettings()['site.domain'] || '').replace(/\/$/, '');
  return `${domain}${url}`;
}

/* -------------------------------- 404 -------------------------------- */

publicRouter.use((req, res) => {
  const settings = getSettings();
  res.status(404).render('error', {
    ...baseContext(req, {
      pageKind: 'error',
      pageTitle: `没有这个页面 · ${settings['site.title']}`,
      description: '没有找到这个页面。',
      bodyClass: 'page-shell',
    }),
    code: '404',
    message: '没有找到这个页面。',
    navSections: BLOOM_SECTIONS,
    world: 'bloom',
  });
});

/* ------------------------------------------------------------------ *
 * 墨色世界的首页 /ink/：只有四个字和一张照片。
 * 年份与文章在 /log/（归心）那一页。
 * ------------------------------------------------------------------ */
publicRouter.get('/ink/', (req, res) => {
  const settings = getSettings();
  res.render('ink-home', {
    ...contextForSection(req, 'log', {
      pageKind: 'home',
      pageTitle: `归心 · 入梦 · ${settings['site.title']}`,
      description: settings['site.description'],
      bodyClass: 'page-shell page-shell--log ink-home-page',
      inkHome: true,
      navSections: BLOOM_SECTIONS,
    }),
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { ASSET_DIR, SECTIONS, sectionOf } from './config.mjs';
import { getSettings, listSocialLinks } from './settings.mjs';
import { activeVisual, visualUrl } from './visuals.mjs';

/* ------------------------------ 资源版本 ------------------------------ */

let cachedVersion = String(Date.now());

export function assetVersion() {
  try {
    const stats = ['site.js', 'site.css', 'admin.js', 'admin.css']
      .map((name) => {
        const file = path.join(ASSET_DIR, name);
        return fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
      })
      .reduce((a, b) => Math.max(a, b), 0);
    if (stats) cachedVersion = String(Math.round(stats));
  } catch {
    /* 用启动时间兜底 */
  }
  return cachedVersion;
}

/* ------------------------------- 社交图标 ------------------------------- */

const ICONS = {
  xiaohongshu:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.6" y="5.2" width="18.8" height="13.6" rx="3.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.4 10.2h9.2M7.4 13.6h5.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  douyin:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.2 3.6v9.9a3.4 3.4 0 1 1-3-3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14.2 5.4c.7 2 2.4 3.3 4.6 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6a9.4 9.4 0 0 0-3 18.3c.5.1.7-.2.7-.5v-1.7c-2.4.5-3-1.1-3-1.1-.4-1-1-1.3-1-1.3-.9-.6 0-.6 0-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.4-2-.2-4.2-1-4.2-4.5 0-1 .3-1.8.9-2.4-.1-.2-.4-1.1.1-2.3 0 0 .8-.3 2.6 1a8.8 8.8 0 0 1 4.7 0c1.8-1.3 2.6-1 2.6-1 .5 1.2.2 2.1.1 2.3.6.6.9 1.4.9 2.4 0 3.5-2.2 4.3-4.2 4.5.5.4.8 1.1.8 2.2v2.9c0 .3.2.6.7.5A9.4 9.4 0 0 0 12 2.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  email:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.4" width="18" height="13.2" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.2 7.2 12 12.9l7.8-5.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  wechat:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.3 4.6c-3.6 0-6.5 2.2-6.5 5 0 1.6.9 3 2.3 3.9l-.6 2 2.3-1.2c.8.2 1.6.3 2.5.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M20.9 14.4c0-2.4-2.4-4.3-5.3-4.3s-5.3 1.9-5.3 4.3 2.4 4.3 5.3 4.3c.7 0 1.4-.1 2-.3l1.9 1-.5-1.7c1.2-.8 1.9-2 1.9-3.3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  weibo:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="10.4" cy="14.4" rx="6.6" ry="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M16.6 5.6c2.4 0 4.2 1.8 4.2 4.2M16.8 9c.9 0 1.6.7 1.6 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  bilibili:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="6.6" width="17.6" height="12.2" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 3.6l2.6 3M16 3.6l-2.6 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.4 11.4v3.4M14.6 11.4v3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  rss: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.6 18.4h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M5 11.4a7.6 7.6 0 0 1 7.6 7.6M5 5.2A13.4 13.4 0 0 1 18.4 18.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13.6 10.4a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

export function socialIcon(platform) {
  return ICONS[String(platform || '').toLowerCase()] || ICONS.link;
}

export const sunMoonGlyph =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M4.6 15.4l1.3-1.3M14.1 5.9l1.3-1.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

export const ACCENTS = {
  origin: { color: '#6f9e5a', soft: 'rgba(111,158,90,0.14)' },
  self: { color: '#cf7891', soft: 'rgba(207,120,145,0.14)' },
  bloom: { color: '#8a7ac8', soft: 'rgba(138,122,200,0.14)' },
  log: { color: '#5c5c5c', soft: 'rgba(60,60,60,0.10)' },
  home: { color: '#c58fa8', soft: 'rgba(197,143,168,0.12)' },
};

export const BLOOM_SECTIONS = SECTIONS.filter((s) => s.key !== 'log');

function absoluteUrl(settings, urlPath) {
  const domain = (settings['site.domain'] || '').replace(/\/$/, '');
  if (!domain) return urlPath;
  return `${domain}${urlPath}`;
}

/**
 * 构造页面渲染上下文：所有模板共用的字段都在这里兜底，
 * 避免某个页面漏传变量导致整站渲染失败。
 */
export function baseContext(req, overrides = {}) {
  const settings = getSettings();
  const site = {
    title: settings['site.title'],
    name: settings['site.name'],
    handle: settings['site.handle'],
    domain: settings['site.domain'],
    tagline: settings['site.tagline'],
    description: settings['site.description'],
  };
  const pathOnly = req.path || '/';
  const canonical = absoluteUrl(settings, pathOnly === '/' ? '/' : pathOnly);

  return {
    settings,
    site,
    socialLinks: listSocialLinks({ onlyVisible: true }),
    socialIcon,
    sunMoonGlyph,
    assetVersion: assetVersion(),
    navVariant: 'bar',
    navSections: BLOOM_SECTIONS,
    activeSection: '',
    world: 'bloom',
    accent: 'home',
    accentColor: ACCENTS.home.color,
    bodyClass: 'page-shell',
    pageKind: 'page',
    pageTitle: site.title,
    description: settings['seo.defaultDescription'] || site.description,
    canonical,
    ogImage: settings['seo.defaultImage'] || '',
    hasMath: false,
    defaultWorld: settings['world.default'] === 'ink' ? 'ink' : 'bloom',
    article: null,
    previewMode: false,
    canEdit: false,
    ...overrides,
  };
}

export function contextForSection(req, sectionKey, overrides = {}) {
  const section = sectionOf(sectionKey) || sectionOf('bloom');
  const isLog = section.key === 'log';
  const accent = ACCENTS[section.key] || ACCENTS.bloom;
  return baseContext(req, {
    activeSection: section.key,
    accent: section.key,
    accentColor: accent.color,
    world: isLog ? 'ink' : 'bloom',
    navVariant: isLog ? 'ink' : 'bar',
    navSections: isLog ? [sectionOf('log')] : BLOOM_SECTIONS,
    section,
    pageKind: 'archive',
    ...overrides,
  });
}

export function activeVisualFor(world, settings) {
  const row = activeVisual(world);
  if (!row) {
    const fallback = settings?.[`${world}.fallback`] || '';
    return { url: fallback, row: null };
  }
  return { url: visualUrl(row), row };
}

/* ==================================================================== *
 * 首页与顶栏需要的东西：
 *   - sunSvg：顶栏圆形小图（一个太阳，光线里带一点七彩色）
 *   - navSections：白底世界的三个栏目，顺序为 绽放 → 本真 → 缘起
 *   - inkNavSection / inkSection：入墨世界唯一的入口「归心」与它的页面信息
 *   - homePhotos：首页「晾晒」的照片，直接取媒体库里最新的 12 张
 * ==================================================================== */
import { all as allRows } from './db.mjs';
import { mediaUrl as mediaUrlOf, thumbUrl as thumbUrlOf } from './media.mjs';

const SUN_SVG = `<svg class="site-sun" viewBox="0 0 40 40" role="img" aria-label="太阳"><g stroke-linecap="round" stroke-width="2"><line x1="20" y1="3" x2="20" y2="7.4" stroke="#a8d5a2"/><line x1="29.5" y1="6.6" x2="27.4" y2="10.4" stroke="#a9cfe8"/><line x1="36.4" y1="14" x2="32.4" y2="15.9" stroke="#8fd0c8"/><line x1="33.8" y1="26" x2="30.1" y2="24" stroke="#b39ddb"/><line x1="25.4" y1="34.2" x2="23.6" y2="30.2" stroke="#f4b8c4"/><line x1="14" y1="34.4" x2="15.7" y2="30.4" stroke="#f08a9b"/><line x1="5.5" y1="26.6" x2="9.5" y2="24.7" stroke="#f7e07a"/><line x1="4.8" y1="14.4" x2="8.8" y2="16.3" stroke="#f5b071"/></g><circle cx="20" cy="20" r="9.4" fill="#f8cc63"/><circle cx="17.3" cy="17.2" r="3.4" fill="#fff5d6" opacity="0.92"/></svg>`;

const __baseContextBeforeHome = baseContext;

function buildSunSvg() {
  return SUN_SVG;
}

function homePhotosFor() {
  return allRows(
    `SELECT * FROM media WHERE kind = 'image' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 12`
  ).map((row) => ({
    url: mediaUrlOf(row),
    thumb: thumbUrlOf(row),
    alt: row.alt || row.original_name || '',
  }));
}

baseContext = function baseContextWithChrome(req, overrides = {}) {
  const ctx = __baseContextBeforeHome(req, overrides);
  ctx.sunSvg = buildSunSvg();
  ctx.navSections = [sectionOf('bloom'), sectionOf('self'), sectionOf('origin')].filter(Boolean);
  ctx.inkNavSection = { key: 'log', name: '归心', href: '/log/' };
  ctx.inkSection = sectionOf('log');
  const path = req.path || '/';
  ctx.homePhotos = path === '/' || path === '/search/' ? homePhotosFor() : [];
  return ctx;
};

/* 首页的 body 也要带上 page-shell--home，颜色变量才对得上 */
const __baseContextWithChrome = baseContext;

baseContext = function baseContextPolish(req, overrides = {}) {
  const ctx = __baseContextWithChrome(req, overrides);
  const path = req.path || '/';
  if (path === '/') ctx.bodyClass = 'page-shell page-shell--home';
  else if (path === '/search/') ctx.bodyClass = 'page-shell page-shell--home open-search';
  return ctx;
};

/* ------------------------------------------------------------------ *
 * 首页照片上写的那几个字：取媒体库的 caption（后台可改），没有就不写。
 * ------------------------------------------------------------------ */
function homePhotoList() {
  return allRows(
    `SELECT * FROM media WHERE kind = 'image' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 12`
  ).map((row) => ({
    url: mediaUrlOf(row),
    thumb: thumbUrlOf(row),
    alt: row.alt || row.original_name || '',
    caption: row.caption || '',
  }));
}

const __baseContextBeforePhotos = baseContext;

baseContext = function baseContextWithPhotoCaptions(req, overrides = {}) {
  const ctx = __baseContextBeforePhotos(req, overrides);
  const path = req.path || '/';
  if (path === '/' || path === '/search/') ctx.homePhotos = homePhotoList();
  return ctx;
};

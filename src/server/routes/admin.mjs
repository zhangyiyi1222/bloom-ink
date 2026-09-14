import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, imageProviderConfig, ROOT } from '../config.mjs';
import {
  clearLoginAttempts,
  createSession,
  createUser,
  currentUser,
  destroySession,
  findUser,
  loginAllowed,
  noteLoginFailure,
  sessionCookieOptions,
  userCount,
  verifyPassword,
} from '../auth.mjs';
import {
  articleStats,
  createArticle,
  deleteArticle,
  getArticle,
  listArticles,
  listRevisions,
  purgeArticle,
  restoreArticle,
  restoreRevision,
  setStatus,
  updateArticle,
} from '../articles.mjs';
import {
  deleteMedia,
  listMedia,
  mediaStats,
  mediaUrl,
  restoreMedia,
  saveUpload,
  thumbUrl,
  updateMedia,
  hasSharp,
} from '../media.mjs';
import {
  apiStatus,
  createSocialLink,
  deleteSocialLink,
  getSettings,
  listSocialLinks,
  replaceSocialLinks,
  setSettings,
  updateSocialLink,
} from '../settings.mjs';
import { indexStatus, rebuildIndex } from '../search.mjs';
import {
  activateVisual,
  deleteVisual,
  generateVisuals,
  listVisuals,
  visualThumbUrl,
  visualUrl,
} from '../visuals.mjs';
import { ZipBuilder } from '../zip.mjs';
import { createPreviewToken } from './public.mjs';
import { ACCENTS, assetVersion, BLOOM_SECTIONS, socialIcon } from '../pages.mjs';
import { getSettings as settingsForView } from '../settings.mjs';
import { SECTIONS } from '../config.mjs';
import { logActivity } from '../db.mjs';

export const apiRouter = express.Router();
export const adminRouter = express.Router();

/* ------------------------------- 鉴权 ------------------------------- */

function requireAuth(req, res, next) {
  const user = currentUser(req.cookies?.session);
  if (!user) return res.status(401).json({ error: '未登录' });
  req.user = user;
  return next();
}

apiRouter.get('/status', (req, res) => {
  const user = currentUser(req.cookies?.session);
  res.json({
    needsSetup: userCount() === 0,
    loggedIn: Boolean(user),
    user: user ? { id: user.id, username: user.username } : null,
    stats: user ? articleStats() : null,
    search: user ? indexStatus() : null,
    api: user ? apiStatus() : null,
    sharp: user ? { available: null } : null,
  });
});

apiRouter.post('/setup', (req, res) => {
  if (userCount() > 0) return res.status(400).json({ error: '管理员已存在' });
  const { username, password } = req.body || {};
  if (!username || String(username).length < 2) return res.status(400).json({ error: '用户名太短' });
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: '密码至少 8 位' });
  }
  const user = createUser(String(username), String(password));
  const cookie = createSession(user.id, req.headers['user-agent']);
  res.cookie('session', cookie, sessionCookieOptions());
  logActivity('setup', `创建管理员 ${user.username}`);
  res.json({ ok: true, user: { id: user.id, username: user.username } });
});

apiRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = `${req.ip}:${username}`;
  if (!loginAllowed(key)) return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
  const user = findUser(String(username || ''));
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    noteLoginFailure(key);
    return res.status(401).json({ error: '用户名或密码不正确' });
  }
  clearLoginAttempts(key);
  const cookie = createSession(user.id, req.headers['user-agent']);
  res.cookie('session', cookie, sessionCookieOptions());
  res.json({ ok: true, user: { id: user.id, username: user.username } });
});

apiRouter.post('/logout', (req, res) => {
  destroySession(req.cookies?.session);
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});

apiRouter.post('/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(String(current || ''), req.user.password_hash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  if (!next || String(next).length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
  setPassword(req.user.id, String(next));
  res.json({ ok: true });
});

/* ------------------------------- 文章 ------------------------------- */

apiRouter.get('/articles', requireAuth, (req, res) => {
  const result = listArticles({
    section: req.query.section || '',
    status: req.query.status || '',
    q: req.query.q || '',
    trash: req.query.trash === '1',
    limit: Math.min(200, Number(req.query.limit) || 60),
    offset: Number(req.query.offset) || 0,
  });
  res.json(result);
});

apiRouter.post('/articles', requireAuth, (req, res) => {
  const article = createArticle(req.body || {});
  logActivity('article.create', `新建文章 #${article.id} ${article.title}`);
  res.json({ article });
});

apiRouter.get('/articles/:id', requireAuth, (req, res) => {
  const article = getArticle(Number(req.params.id));
  if (!article) return res.status(404).json({ error: '文章不存在' });
  res.json({ article });
});

apiRouter.put('/articles/:id', requireAuth, (req, res) => {
  const article = updateArticle(Number(req.params.id), req.body || {});
  if (!article) return res.status(404).json({ error: '文章不存在' });
  res.json({ article });
});

apiRouter.post('/articles/:id/status', requireAuth, (req, res) => {
  const article = setStatus(Number(req.params.id), req.body?.status, req.body?.published_at);
  if (!article) return res.status(400).json({ error: '状态无效' });
  logActivity('article.status', `#${article.id} → ${article.status}`);
  res.json({ article });
});

apiRouter.delete('/articles/:id', requireAuth, (req, res) => {
  const permanent = req.query.permanent === '1';
  const article = permanent ? purgeArticle(Number(req.params.id)) : deleteArticle(Number(req.params.id));
  if (!article) return res.status(404).json({ error: '文章不存在' });
  logActivity(permanent ? 'article.purge' : 'article.trash', `#${article.id} ${article.title}`);
  res.json({ ok: true, article });
});

apiRouter.post('/articles/:id/restore', requireAuth, (req, res) => {
  const article = restoreArticle(Number(req.params.id));
  if (!article) return res.status(404).json({ error: '文章不存在' });
  res.json({ article });
});

apiRouter.get('/articles/:id/revisions', requireAuth, (req, res) => {
  res.json({ revisions: listRevisions(Number(req.params.id)) });
});

apiRouter.post('/articles/:id/revisions/:revisionId/restore', requireAuth, (req, res) => {
  const article = restoreRevision(Number(req.params.id), Number(req.params.revisionId));
  if (!article) return res.status(404).json({ error: '版本不存在' });
  res.json({ article });
});

apiRouter.post('/articles/:id/preview-token', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!getArticle(id)) return res.status(404).json({ error: '文章不存在' });
  res.json({ url: `/preview/${id}?token=${createPreviewToken(id)}` });
});

apiRouter.delete('/trash', requireAuth, (req, res) => {
  const { rows } = listArticles({ trash: true, limit: 500 });
  for (const row of rows) purgeArticle(row.id);
  logActivity('trash.empty', `清空回收站 ${rows.length} 篇`);
  res.json({ ok: true, removed: rows.length });
});

/* ------------------------------- 媒体 ------------------------------- */

apiRouter.get('/media', requireAuth, (req, res) => {
  const result = listMedia({
    limit: Math.min(200, Number(req.query.limit) || 60),
    offset: Number(req.query.offset) || 0,
    kind: req.query.kind || '',
    q: req.query.q || '',
  });
  res.json({
    total: result.total,
    stats: mediaStats(),
    rows: result.rows.map((row) => ({
      ...row,
      url: mediaUrl(row),
      webp: mediaUrl(row, 'webp'),
      thumb: thumbUrl(row),
    })),
  });
});

apiRouter.post('/media/upload', requireAuth, express.raw({ type: '*/*', limit: process.env.MAX_UPLOAD_MB || '200mb' }), async (req, res) => {
  try {
    const originalName = decodeURIComponent(String(req.headers['x-file-name'] || 'file'));
    const row = await saveUpload({
      buffer: req.body,
      originalName,
      mime: String(req.headers['content-type'] || 'application/octet-stream').split(';')[0],
      alt: req.query.alt ? String(req.query.alt) : '',
      caption: req.query.caption ? String(req.query.caption) : '',
    });
    logActivity('media.upload', `${row.original_name} (${row.kind})`);
    res.json({
      id: row.id,
      url: mediaUrl(row),
      webp: mediaUrl(row, 'webp'),
      thumb: thumbUrl(row),
      kind: row.kind,
      width: row.width,
      height: row.height,
      size: row.size,
      mime: row.mime,
      original_name: row.original_name,
      alt: row.alt,
      caption: row.caption,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || '上传失败' });
  }
});

apiRouter.patch('/media/:id', requireAuth, (req, res) => {
  const row = updateMedia(Number(req.params.id), req.body || {});
  if (!row) return res.status(404).json({ error: '文件不存在' });
  res.json({ media: { ...row, url: mediaUrl(row), thumb: thumbUrl(row) } });
});

apiRouter.delete('/media/:id', requireAuth, (req, res) => {
  const permanent = req.query.permanent === '1';
  if (permanent) {
    const row = deleteMedia(Number(req.params.id));
    if (row) {
      const abs = path.join(UPLOAD_DIR, row.path);
      try {
        fs.unlinkSync(abs);
        if (row.variants) {
          for (const rel of Object.values(JSON.parse(row.variants))) {
            try {
              fs.unlinkSync(path.join(UPLOAD_DIR, rel));
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    return res.json({ ok: true, purged: Boolean(row) });
  }
  const row = deleteMedia(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '文件不存在' });
  res.json({ ok: true });
});

apiRouter.post('/media/:id/restore', requireAuth, (req, res) => {
  const row = restoreMedia(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '文件不存在' });
  res.json({ ok: true });
});

/* ------------------------------- 设置 ------------------------------- */

apiRouter.get('/settings', requireAuth, (req, res) => {
  res.json({
    settings: getSettings(),
    social: listSocialLinks(),
    api: apiStatus(),
    sections: SECTIONS,
  });
});

apiRouter.put('/settings', requireAuth, (req, res) => {
  const patch = req.body?.settings || {};
  const next = setSettings(patch);
  if (Array.isArray(req.body?.social)) replaceSocialLinks(req.body.social);
  res.json({ settings: next, social: listSocialLinks() });
});

apiRouter.post('/social', requireAuth, (req, res) => {
  res.json({ link: createSocialLink(req.body || {}) });
});

apiRouter.patch('/social/:id', requireAuth, (req, res) => {
  const link = updateSocialLink(Number(req.params.id), req.body || {});
  if (!link) return res.status(404).json({ error: '链接不存在' });
  res.json({ link });
});

apiRouter.delete('/social/:id', requireAuth, (req, res) => {
  deleteSocialLink(Number(req.params.id));
  res.json({ ok: true });
});

/* ------------------------------ 视觉资产 ------------------------------ */

apiRouter.get('/visuals', requireAuth, (req, res) => {
  const world = req.query.world === 'ink' ? 'ink' : 'bloom';
  res.json({
    world,
    rows: listVisuals(world).map((row) => ({
      ...row,
      url: visualUrl(row),
      thumb: visualThumbUrl(row),
    })),
    api: apiStatus(),
  });
});

apiRouter.post('/visuals/generate', requireAuth, async (req, res) => {
  const world = req.body?.world === 'ink' ? 'ink' : 'bloom';
  const settings = getSettings();
  const prompt = String(req.body?.prompt || settings[`${world}.prompt`] || '');
  if (prompt.length < 4) return res.status(400).json({ error: '请填写生成描述' });
  try {
    const rows = await generateVisuals({ world, prompt, count: Number(req.body?.count) || 3 });
    logActivity('visual.generate', `${world} × ${rows.length}`);
    res.json({
      rows: rows.map((row) => ({ ...row, url: visualUrl(row), thumb: visualThumbUrl(row) })),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || '生成失败' });
  }
});

apiRouter.post('/visuals/:id/activate', requireAuth, (req, res) => {
  const row = activateVisualWithSettings(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '素材不存在' });
  res.json({ visual: { ...row, url: visualUrl(row), thumb: visualThumbUrl(row) } });
});

apiRouter.delete('/visuals/:id', requireAuth, (req, res) => {
  const row = deleteVisualWithSettings(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '素材不存在' });
  res.json({ ok: true });
});

/* ------------------------------ 搜索索引 ------------------------------ */

apiRouter.get('/search/status', requireAuth, (req, res) => {
  res.json(indexStatus());
});

apiRouter.post('/search/rebuild', requireAuth, (req, res) => {
  const count = rebuildIndex();
  logActivity('search.rebuild', `${count} 篇`);
  res.json({ ...indexStatus(), rebuilt: count });
});

/* ---------------------------- 导出 / 备份 ---------------------------- */

function markdownFor(article) {
  const front = [
    '---',
    `title: ${article.title}`,
    `slug: ${article.slug}`,
    `section: ${article.section}`,
    `status: ${article.status}`,
    `published_at: ${article.published_at || ''}`,
    `tags: ${article.tags || ''}`,
    `seo_description: ${(article.seo_description || '').replace(/\n/g, ' ')}`,
    `permalink: ${article.permalink || ''}`,
    '---',
    '',
  ].join('\n');
  return `${front}${article.content}\n`;
}

function exportBundle({ includeMedia, includeVisuals }) {
  const zip = new ZipBuilder();
  const { rows } = listArticles({ limit: 5000 });
  const files = [];
  for (const row of rows) {
    const article = getArticle(row.id);
    const name = `${article.section}/${(article.published_at || '').slice(0, 10)}-${article.slug}.md`;
    zip.add(`articles/${name}`, markdownFor(article));
    files.push(name);
  }
  zip.add('settings.json', JSON.stringify({ settings: getSettings(), social: listSocialLinks() }, null, 2));

  if (includeVisuals) {
    for (const row of listVisuals('bloom', 200).concat(listVisuals('ink', 200))) {
      const abs = path.join(ROOT, 'data', 'visuals', row.path);
      if (fs.existsSync(abs)) zip.add(`visuals/${row.world}/${row.path}`, fs.readFileSync(abs));
    }
  }

  if (includeMedia) {
    const { rows: mediaRows } = listMedia({ limit: 5000 });
    const manifest = [];
    for (const row of mediaRows) {
      const abs = path.join(UPLOAD_DIR, row.path);
      if (fs.existsSync(abs)) zip.add(`media/${row.path}`, fs.readFileSync(abs));
      manifest.push({
        path: row.path,
        original_name: row.original_name,
        mime: row.mime,
        kind: row.kind,
        alt: row.alt,
        caption: row.caption,
        width: row.width,
        height: row.height,
      });
    }
    zip.add('media.json', JSON.stringify(manifest, null, 2));
  }
  zip.add('README.txt', 'Bloom/Ink 导出：articles/ 下是纯 Markdown，可直接迁移到任何静态博客。\n');
  return zip.build();
}

apiRouter.get('/export/markdown', requireAuth, (req, res) => {
  const buffer = exportBundle({ includeMedia: false, includeVisuals: false });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="articles-markdown.zip"');
  res.send(buffer);
});

apiRouter.get('/backup', requireAuth, (req, res) => {
  const buffer = exportBundle({ includeMedia: true, includeVisuals: true });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="bloom-ink-backup-${Date.now()}.zip"`);
  res.send(buffer);
});

/* ---------------------------- 后台页面外壳 ---------------------------- */

adminRouter.use(express.json({ limit: '5mb' }));

adminRouter.get(['/', '/*path'], (req, res) => {
  const user = currentUser(req.cookies?.session);
  const settings = settingsForView();
  res.render('admin', {
    site: {
      title: settings['site.title'],
      name: settings['site.name'],
      handle: settings['site.handle'],
    },
    assetVersion: assetVersion(),
    hasUser: userCount() > 0,
    loggedIn: Boolean(user),
    mount: req.path,
    socialIcon,
    ACCENTS,
    bloomSections: BLOOM_SECTIONS,
  });
});
import { setPassword } from '../auth.mjs';
import { activateVisualWithSettings, deleteVisualWithSettings } from '../visualstate.mjs';

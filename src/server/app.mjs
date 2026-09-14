import express from 'express';
import path from 'node:path';
import { ASSET_DIR, PUBLIC_DIR, ROOT, UPLOAD_DIR, VIEW_DIR } from './config.mjs';
import { VISUAL_DIR } from './visuals.mjs';
import { publicRouter } from './routes/public.mjs';
import { adminRouter, apiRouter } from './routes/admin.mjs';
import { cleanupSessions, currentUser } from './auth.mjs';
import { baseContext } from './pages.mjs';
import { getSettings } from './settings.mjs';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', VIEW_DIR);
  app.locals.pretty = false;

  app.use((req, res, next) => {
    const header = req.headers.cookie || '';
    const jar = {};
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const key = part.slice(0, idx).trim();
      if (!key) continue;
      try {
        jar[key] = decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        jar[key] = part.slice(idx + 1).trim();
      }
    }
    req.cookies = jar;
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  app.use(
    '/assets',
    express.static(ASSET_DIR, { maxAge: '7d', immutable: false, index: false })
  );
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', index: false }));
  app.use('/visuals', express.static(VISUAL_DIR, { maxAge: '30d', index: false }));
  app.use('/vendor', express.static(path.join(PUBLIC_DIR, 'vendor'), { maxAge: '30d' }));
  app.use('/static', express.static(path.join(PUBLIC_DIR, 'static'), { maxAge: '7d' }));

  app.get('/favicon.ico', (req, res) => {
    res.type('image/svg+xml').sendFile(path.join(PUBLIC_DIR, 'static', 'favicon.svg'));
  });

  app.use('/api', apiRouter);
  app.use('/admin', adminRouter);
  app.use('/', publicRouter);

  app.use((error, req, res, next) => {
    console.error('[error]', error);
    if (res.headersSent) return next(error);
    const settings = getSettings();
    const wantsJson = req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
    if (wantsJson) {
      return res.status(500).json({ error: error.message || '服务器内部错误' });
    }
    res.status(500).render('error', {
      ...baseContext(req, {
        pageKind: 'error',
        pageTitle: `出错了 · ${settings['site.title']}`,
        description: '服务器内部错误。',
        bodyClass: 'page-shell',
      }),
      code: '500',
      message: '出了点问题，稍后再试。',
      world: 'bloom',
      navSections: [],
    });
  });

  cleanupSessions();
  return app;
}

export { ROOT, currentUser };

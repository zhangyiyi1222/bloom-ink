import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, all, run, nowIso } from './db.mjs';
import { UPLOAD_DIR } from './config.mjs';

let sharpModule = null;
let sharpTried = false;

async function loadSharp() {
  if (sharpTried) return sharpModule;
  sharpTried = true;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

export async function hasSharp() {
  return Boolean(await loadSharp());
}

const KIND_BY_MIME = (mime) => {
  if (!mime) return 'file';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
};

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

function safeName(originalName, mime, hash) {
  const ext =
    EXT_BY_MIME[mime] ||
    (path.extname(String(originalName || '')).replace('.', '').toLowerCase() || 'bin');
  const base = path
    .basename(String(originalName || 'file'), path.extname(String(originalName || '')))
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'media';
  return `${base}-${hash}.${ext.replace(/[^a-z0-9]/gi, '')}`;
}

function monthFolder(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return { rel: path.posix.join(String(y), m), abs: path.join(UPLOAD_DIR, String(y), m) };
}

/**
 * 保存一个上传文件。
 * @param {{buffer: Buffer, originalName?: string, mime?: string, alt?: string, caption?: string}} input
 */
export async function saveUpload({ buffer, originalName = '', mime = '', alt = '', caption = '' }) {
  if (!buffer || !buffer.length) throw new Error('文件内容为空');
  const maxBytes = Number(process.env.MAX_UPLOAD_MB || 200) * 1024 * 1024;
  if (buffer.length > maxBytes) throw new Error(`文件超过上限（${process.env.MAX_UPLOAD_MB || 200}MB）`);

  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 8);
  const filename = safeName(originalName, mime, hash);
  const { rel, abs } = monthFolder();
  fs.mkdirSync(abs, { recursive: true });
  const absPath = path.join(abs, filename);
  fs.writeFileSync(absPath, buffer);

  const kind = KIND_BY_MIME(mime);
  let width = null;
  let height = null;
  let variants = null;

  if (kind === 'image') {
    const sharp = await loadSharp();
    if (sharp && mime !== 'image/svg+xml' && mime !== 'image/gif') {
      try {
        const image = sharp(buffer, { failOn: 'none' });
        const meta = await image.metadata();
        width = meta.width || null;
        height = meta.height || null;
        const base = path.join(abs, path.basename(filename, path.extname(filename)));
        const webpName = `${path.basename(base)}.webp`;
        const thumbName = `${path.basename(base)}.thumb.webp`;
        await sharp(buffer, { failOn: 'none' })
          .rotate()
          .resize({ width: 2200, withoutEnlargement: true })
          .webp({ quality: 84 })
          .toFile(path.join(abs, webpName));
        await sharp(buffer, { failOn: 'none' })
          .rotate()
          .resize({ width: 520, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(path.join(abs, thumbName));
        variants = {
          webp: path.posix.join(rel, webpName),
          thumb: path.posix.join(rel, thumbName),
        };
      } catch (error) {
        variants = null;
      }
    } else if (sharp) {
      try {
        const meta = await sharp(buffer, { failOn: 'none' }).metadata();
        width = meta.width || null;
        height = meta.height || null;
      } catch {
        /* ignore */
      }
    }
  }

  const info = run(
    `INSERT INTO media (filename, path, original_name, mime, kind, width, height, size, alt, caption, variants, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    filename,
    path.posix.join(rel, filename),
    originalName,
    mime || 'application/octet-stream',
    kind,
    width,
    height,
    buffer.length,
    alt,
    caption,
    variants ? JSON.stringify(variants) : null,
    nowIso()
  );

  invalidateDimensionCache();
  return getMedia(Number(info.lastInsertRowid));
}

export function mediaUrl(row, variant = 'original') {
  if (!row) return '';
  let rel = row.path;
  if (variant === 'webp' && row.variants) {
    try {
      rel = JSON.parse(row.variants).webp || rel;
    } catch {
      /* ignore */
    }
  }
  return `/uploads/${rel}`;
}

export function thumbUrl(row) {
  if (!row) return '';
  if (row.variants) {
    try {
      const parsed = JSON.parse(row.variants);
      if (parsed.thumb) return `/uploads/${parsed.thumb}`;
    } catch {
      /* ignore */
    }
  }
  return mediaUrl(row);
}

export function getMedia(id) {
  return get('SELECT * FROM media WHERE id = ? AND deleted_at IS NULL', id) || null;
}

export function listMedia({ limit = 200, offset = 0, kind = '', q = '' } = {}) {
  const params = [];
  let sql = 'SELECT * FROM media WHERE deleted_at IS NULL';
  if (kind) {
    sql += ' AND kind = ?';
    params.push(kind);
  }
  if (q) {
    sql += ' AND (original_name LIKE ? OR alt LIKE ? OR filename LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = all(sql, ...params);
  const total = get(
    'SELECT COUNT(*) AS n FROM media WHERE deleted_at IS NULL' + (kind ? ' AND kind = ?' : ''),
    ...(kind ? [kind] : [])
  ).n;
  return { rows, total };
}

export function updateMedia(id, { alt, caption, original_name }) {
  run(
    'UPDATE media SET alt = COALESCE(?, alt), caption = COALESCE(?, caption), original_name = COALESCE(?, original_name) WHERE id = ?',
    alt ?? null,
    caption ?? null,
    original_name ?? null,
    id
  );
  return getMedia(id);
}

export function deleteMedia(id) {
  const row = getMedia(id);
  if (!row) return null;
  run('UPDATE media SET deleted_at = ? WHERE id = ?', nowIso(), id);
  invalidateDimensionCache();
  return row;
}

export function restoreMedia(id) {
  run('UPDATE media SET deleted_at = NULL WHERE id = ?', id);
  invalidateDimensionCache();
  return getMedia(id);
}

export function mediaPath(row) {
  return path.join(UPLOAD_DIR, row.path);
}

export function mediaKindOf(row) {
  return row ? row.kind : 'file';
}

/* ---------------- 尺寸索引：让正文图片带上宽高，避免加载时跳动 ---------------- */

let dimensionCache = null;

export function invalidateDimensionCache() {
  dimensionCache = null;
}

export function mediaDimensionIndex() {
  if (dimensionCache) return dimensionCache;
  const map = new Map();
  for (const row of all('SELECT path, width, height, variants FROM media WHERE deleted_at IS NULL')) {
    if (!row.width || !row.height) continue;
    map.set(`/uploads/${row.path}`, { width: row.width, height: row.height });
    if (row.variants) {
      try {
        const parsed = JSON.parse(row.variants);
        for (const key of ['webp', 'thumb']) {
          if (parsed[key]) map.set(`/uploads/${parsed[key]}`, { width: row.width, height: row.height });
        }
      } catch {
        /* ignore */
      }
    }
  }
  dimensionCache = map;
  return map;
}

export function mediaStats() {
  const rows = all(
    "SELECT kind, COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM media WHERE deleted_at IS NULL GROUP BY kind"
  );
  const total = get('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM media WHERE deleted_at IS NULL');
  return { byKind: rows, total };
}

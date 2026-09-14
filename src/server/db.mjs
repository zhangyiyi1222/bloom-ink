import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE, DATA_DIR } from './config.mjs';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL,
  section TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_format TEXT NOT NULL DEFAULT 'markdown',
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  permalink TEXT,
  seo_description TEXT,
  tags TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_slug
  ON articles(section, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_articles_section
  ON articles(section, status, published_at);
CREATE INDEX IF NOT EXISTS idx_articles_deleted
  ON articles(deleted_at);

CREATE TABLE IF NOT EXISTS article_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  seo_description TEXT,
  tags TEXT,
  status TEXT,
  published_at TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_article
  ON article_revisions(article_id, id DESC);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  original_name TEXT,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  alt TEXT,
  caption TEXT,
  variants TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visual_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  world TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  thumb_path TEXT,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  active INTEGER NOT NULL DEFAULT 0,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visuals_world ON visual_assets(world, created_at DESC);

CREATE TABLE IF NOT EXISTS search_index (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  permalink TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

db.exec(SCHEMA);

export function nowIso() {
  return new Date().toISOString();
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function logActivity(kind, message) {
  run(
    'INSERT INTO activity_log (kind, message, created_at) VALUES (?, ?, ?)',
    kind,
    message,
    nowIso()
  );
}

export function dbFilePath() {
  return path.resolve(DB_FILE);
}

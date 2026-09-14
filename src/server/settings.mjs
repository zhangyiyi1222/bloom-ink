import { all, get, run, nowIso } from './db.mjs';
import { imageProviderConfig } from './config.mjs';

const DEFAULT_SETTINGS = {
  'site.title': '一个人像一朵花',
  'site.name': '张中伟',
  'site.handle': '@zhangzhongwei',
  'site.domain': 'https://zhangzhongwei.top',
  'site.tagline': '面对世界时绽放，回到自己时入墨',
  'site.description': '一个人像一朵花。面对世界时绽放，回到自己时入墨。',
  'seo.defaultDescription': '一个人像一朵花。面对世界时绽放，回到自己时入墨。',
  'seo.defaultImage': '',
  'world.default': 'bloom',
  'bloom.prompt':
    '东方写意花开的抽象视觉，嫩绿、天空蓝、水青、粉红、桃红、紫罗兰、阳光黄、暖橙、金色，来自自然生命的光色，柔和粒子与光晕，留白多，无文字，超宽构图',
  'ink.prompt':
    '极淡水墨自然景象，远山与薄雾，宣纸纸纹，墨色层次极轻，大量留白，安静，无文字，超宽构图',
};

export function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return DEFAULT_SETTINGS[key] ?? null;
  return row.value;
}

export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of all('SELECT key, value FROM settings')) out[row.key] = row.value;
  return out;
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    String(value ?? ''),
    nowIso()
  );
  return getSetting(key);
}

export function setSettings(patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    setSetting(key, value);
  }
  return getSettings();
}

export function defaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

/* ----------------------------- 社交链接 ----------------------------- */

export function listSocialLinks({ onlyVisible = false } = {}) {
  const sql = `SELECT * FROM social_links ${onlyVisible ? 'WHERE visible = 1' : ''} ORDER BY sort ASC, id ASC`;
  return all(sql);
}

export function createSocialLink({ platform, label = '', handle = '', url = '', visible = 1, sort = 0 }) {
  const info = run(
    'INSERT INTO social_links (platform, label, handle, url, visible, sort) VALUES (?, ?, ?, ?, ?, ?)',
    platform,
    label,
    handle,
    url,
    visible ? 1 : 0,
    Number(sort) || 0
  );
  return get('SELECT * FROM social_links WHERE id = ?', Number(info.lastInsertRowid));
}

export function updateSocialLink(id, patch = {}) {
  const current = get('SELECT * FROM social_links WHERE id = ?', id);
  if (!current) return null;
  run(
    'UPDATE social_links SET platform = ?, label = ?, handle = ?, url = ?, visible = ?, sort = ? WHERE id = ?',
    patch.platform ?? current.platform,
    patch.label ?? current.label,
    patch.handle ?? current.handle,
    patch.url ?? current.url,
    patch.visible === undefined ? current.visible : patch.visible ? 1 : 0,
    patch.sort === undefined ? current.sort : Number(patch.sort) || 0,
    id
  );
  return get('SELECT * FROM social_links WHERE id = ?', id);
}

export function deleteSocialLink(id) {
  run('DELETE FROM social_links WHERE id = ?', id);
}

export function replaceSocialLinks(list = []) {
  run('DELETE FROM social_links');
  list.slice(0, 8).forEach((item, index) => {
    createSocialLink({
      platform: String(item.platform || 'link'),
      label: String(item.label || ''),
      handle: String(item.handle || ''),
      url: String(item.url || ''),
      visible: item.visible === false ? 0 : 1,
      sort: Number(item.sort ?? index),
    });
  });
  return listSocialLinks();
}

/** 后台用的 API 配置状态：只回显“是否已配置”，绝不回显密钥。 */
export function apiStatus() {
  const cfg = imageProviderConfig();
  return {
    provider: cfg.provider,
    configured: cfg.configured,
    model: cfg.model,
    secretVisible: false,
  };
}

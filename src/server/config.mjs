import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, '.env'));
loadDotEnv(path.join(ROOT, '.env.local'));

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const DB_FILE = path.join(DATA_DIR, 'blog.sqlite');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const VIEW_DIR = path.join(ROOT, 'src', 'views');
export const ASSET_DIR = path.join(PUBLIC_DIR, 'assets');

export const PORT = Number(process.env.PORT || 8787);
export const HOST = process.env.HOST || '127.0.0.1';
export const IS_PROD = process.env.NODE_ENV === 'production';

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR, PUBLIC_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 保存会话签名密钥：首次运行自动生成，之后保持不变。 */
export function sessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf8').trim();
}

/** 图像生成 provider 配置：只从环境变量读取，前端永远拿不到密钥。 */
export function imageProviderConfig() {
  const provider = (process.env.IMAGE_PROVIDER || 'local').toLowerCase();
  return {
    provider,
    configured:
      provider === 'local'
        ? true
        : Boolean(process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY),
    model: process.env.ARK_MODEL || 'doubao-seedream-3-0-t2i-250415',
    endpoint:
      process.env.ARK_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    apiKey: process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY || '',
    size: process.env.IMAGE_SIZE || '1024x1536',
  };
}

export const SECTIONS = [
  { key: 'origin', name: '缘起', en: 'ORIGIN', question: '为什么', hint: '嫩绿' },
  { key: 'self', name: '本我', en: 'SELF', question: '我是什么', hint: '花瓣' },
  { key: 'bloom', name: '绽放', en: 'BLOOM', question: '我与世界', hint: '紫蓝暖金' },
  { key: 'log', name: '日志', en: 'INK', question: '', hint: '墨' },
];

export const SECTION_KEYS = SECTIONS.map((s) => s.key);

export function sectionOf(key) {
  return SECTIONS.find((s) => s.key === key) || null;
}

export function sectionName(key) {
  const s = sectionOf(key);
  return s ? s.name : key;
}

/* 统一时区：文章的日期与月份归档都按 Asia/Shanghai 计算，
   这样即使部署在 UTC 服务器上，日志也不会错位一天。 */
if (!process.env.TZ) process.env.TZ = process.env.SITE_TIMEZONE || 'Asia/Shanghai';

/* ------------------------------------------------------------------ *
 * 栏目名称定稿：
 *   缘起（为什么）· 本真（我是什么）· 绽放（我与世界）· 日志
 * 入墨世界只留一个入口，叫「归心」。
 * ------------------------------------------------------------------ */
const selfSection = SECTIONS.find((item) => item.key === 'self');
if (selfSection) selfSection.name = '本真';

const logSection = SECTIONS.find((item) => item.key === 'log');
if (logSection) {
  logSection.navName = '归心';
  logSection.question = '世界先放一放，我回到自己这里。';
}

/* 归心：真的叫归心了（页面标题也用它） */
if (logSection) logSection.name = '归心';

/* ------------------------------------------------------------------ *
 * 墨色世界拆成两页：
 *   /ink/  首页：只有「归心 · 入梦」四个字和一张照片
 *   /log/  归心：年份 + 文章
 * 所以这里再登记一个栏目键（它不参与后台的文章归档，只用于这条路由）。
 * ------------------------------------------------------------------ */
if (!SECTION_KEYS.includes('ink')) {
  SECTIONS.push({ key: 'ink', name: '归心', question: '入梦', hint: '墨' });
  SECTION_KEYS.push('ink');
}

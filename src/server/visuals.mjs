import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, nowIso } from './db.mjs';
import { DATA_DIR, imageProviderConfig } from './config.mjs';
import { encodePng } from './png.mjs';

export const VISUAL_DIR = path.join(DATA_DIR, 'visuals');
fs.mkdirSync(VISUAL_DIR, { recursive: true });

/* ----------------------------- 噪声工具 ----------------------------- */

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const v00 = hash2(xi, yi, seed);
  const v10 = hash2(xi + 1, yi, seed);
  const v01 = hash2(xi, yi + 1, seed);
  const v11 = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return (v00 * (1 - u) + v10 * u) * (1 - v) + (v01 * (1 - u) + v11 * u) * v;
}

function fbm(x, y, seed, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 37);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function paletteColor(stops, t) {
  const clamped = Math.min(1, Math.max(0, t));
  const pos = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const local = pos - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return [lerp(a[0], b[0], local), lerp(a[1], b[1], local), lerp(a[2], b[2], local)];
}

/* --------------------------- 程序化基础视觉 --------------------------- */

const BLOOM_STOPS = [
  '#fdfcf8',
  '#eaf4df',
  '#a8d5a2',
  '#8fd0c8',
  '#a9cfe8',
  '#f4b8c4',
  '#f08a9b',
  '#b39ddb',
  '#f7e07a',
  '#f5b071',
  '#e8c46a',
  '#fdfbf6',
];

const INK_STOPS = ['#fbfaf6', '#f1eee6', '#e2ded2', '#cfcabd', '#b4b0a4', '#8f8c84', '#6f6d69'];

/** 程序化生成一张基础视觉图（无需任何外部 API）。 */
export function generateProceduralImage(world, prompt = '', width = 1536, height = 1024) {
  const seed = parseInt(crypto.createHash('sha1').update(`${world}:${prompt}`).digest('hex').slice(0, 6), 16);
  const rgba = new Uint8Array(width * height * 4);
  const isInk = world === 'ink';

  // 若干柔和光核：让画面有“光源”和呼吸感
  const cores = [];
  const coreCount = isInk ? 2 : 5;
  for (let i = 0; i < coreCount; i++) {
    cores.push({
      x: hash2(i, 11, seed) * width,
      y: hash2(i, 23, seed) * height,
      r: (isInk ? 0.55 : 0.34) * width * (0.6 + hash2(i, 31, seed) * 0.8),
      power: isInk ? 0.25 : 0.5 + hash2(i, 41, seed) * 0.5,
    });
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;

      // 域扭曲：让形状像自然生长，而不是几何渐变
      const qx = fbm(u * 3.2, v * 3.2, seed, 4);
      const qy = fbm(u * 3.2 + 5.2, v * 3.2 + 1.3, seed + 9, 4);
      const warp = fbm(u * 2.1 + qx * 1.6, v * 2.1 + qy * 1.6, seed + 21, 5);
      const fine = fbm(u * 9.5 + qx, v * 9.5 + qy, seed + 51, 4);

      let r;
      let g;
      let b;

      if (isInk) {
        // 纸的底色 + 极淡墨色层次 + 薄雾 + 远山
        const paper = 250 - fine * 10;
        const wash = Math.pow(warp, 1.6);
        const ridge =
          Math.abs(
            fbm(u * 2.6, v * 0.9, seed + 77, 5) - (0.52 + (v - 0.5) * 0.28)
          ) * 12;
        const mountain = Math.max(0, 1 - ridge) * Math.max(0, v - 0.28) * 0.5;
        const mist = Math.pow(1 - Math.abs(v - 0.55) * 2.4, 2) * 0.12 * fine;
        const t = Math.min(1, wash * 0.72 + mountain + mist);
        const [cr, cg, cb] = paletteColor(INK_STOPS, t);
        const lift = paper - 250;
        r = cr + lift;
        g = cg + lift;
        b = cb + lift * 0.9;
      } else {
        // 生命色场：多种植物色在留白里自然过渡
        const field = Math.min(1, Math.pow(warp, 1.25) * 1.15);
        const [cr, cg, cb] = paletteColor(BLOOM_STOPS, field);
        let glow = 0;
        for (const core of cores) {
          const d = Math.hypot(x - core.x, y - core.y) / core.r;
          glow += Math.exp(-d * d) * core.power;
        }
        glow = Math.min(1.2, glow);
        r = cr + glow * 32;
        g = cg + glow * 30;
        b = cb + glow * 26;
      }

      // 细腻颗粒，避免出现“科技感平移渐变”
      const grain = (hash2(x, y, seed + 3) - 0.5) * (isInk ? 5 : 6);
      const idx = (y * width + x) * 4;
      rgba[idx] = Math.max(0, Math.min(255, r + grain));
      rgba[idx + 1] = Math.max(0, Math.min(255, g + grain));
      rgba[idx + 2] = Math.max(0, Math.min(255, b + grain));
      rgba[idx + 3] = 255;
    }
  }

  return { buffer: encodePng(width, height, rgba), width, height };
}

/* ------------------------------ 存储 ------------------------------ */

/**
 * 把一张生成结果写入视觉资产库（保留历史，不覆盖旧图）。
 * @returns {Promise<object>} visual_assets 行
 */
export async function storeVisual({ world, prompt, buffer, provider, meta = {} }) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 6);
  const filename = `${world}-${stamp}-${hash}.png`;
  const absPath = path.join(VISUAL_DIR, filename);
  fs.writeFileSync(absPath, buffer);

  let width = meta.width || null;
  let height = meta.height || null;
  let thumbPath = null;

  try {
    const sharp = (await import('sharp')).default;
    if (!width || !height) {
      const info = await sharp(buffer).metadata();
      width = info.width || null;
      height = info.height || null;
    }
    const thumbName = `${world}-${stamp}-${hash}.thumb.webp`;
    await sharp(buffer).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(VISUAL_DIR, thumbName));
    thumbPath = thumbName;
  } catch {
    thumbPath = null;
  }

  const info = run(
    `INSERT INTO visual_assets (world, prompt, provider, path, thumb_path, width, height, size, active, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    world,
    prompt || '',
    provider,
    filename,
    thumbPath,
    width,
    height,
    buffer.length,
    JSON.stringify(meta),
    nowIso()
  );
  return get('SELECT * FROM visual_assets WHERE id = ?', Number(info.lastInsertRowid));
}

export function listVisuals(world, limit = 60) {
  return all(
    'SELECT * FROM visual_assets WHERE world = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    world,
    limit
  );
}

export function activeVisual(world) {
  return (
    get('SELECT * FROM visual_assets WHERE world = ? AND active = 1 ORDER BY id DESC', world) || null
  );
}

export function activateVisual(id) {
  const row = get('SELECT * FROM visual_assets WHERE id = ?', id);
  if (!row) return null;
  run('UPDATE visual_assets SET active = 0 WHERE world = ?', row.world);
  run('UPDATE visual_assets SET active = 1 WHERE id = ?', id);
  return get('SELECT * FROM visual_assets WHERE id = ?', id);
}

export function deleteVisual(id) {
  const row = get('SELECT * FROM visual_assets WHERE id = ?', id);
  if (!row) return null;
  run('DELETE FROM visual_assets WHERE id = ?', id);
  try {
    fs.unlinkSync(path.join(VISUAL_DIR, row.path));
    if (row.thumb_path) fs.unlinkSync(path.join(VISUAL_DIR, row.thumb_path));
  } catch {
    /* 文件可能已被手工清理，不影响记录删除 */
  }
  return row;
}

export function visualUrl(row) {
  return row ? `/visuals/${row.path}` : '';
}

export function visualThumbUrl(row) {
  if (!row) return '';
  return `/visuals/${row.thumb_path || row.path}`;
}

/* --------------------------- 生成 provider --------------------------- */

/**
 * provider 抽象：local（本地程序化） / doubao（火山方舟，豆包图像生成）
 * 密钥只从服务端环境变量读取，前端永远拿不到。
 */
export async function generateVisuals({ world, prompt, count = 3 }) {
  const cfg = imageProviderConfig();
  if (cfg.provider === 'local') {
    const results = [];
    const total = Math.max(1, Math.min(6, count));
    for (let i = 0; i < total; i++) {
      const { buffer, width, height } = generateProceduralImage(
        world,
        `${prompt}#${i}`,
        world === 'ink' ? 1440 : 1536,
        1024
      );
      results.push(
        await storeVisual({
          world,
          prompt,
          buffer,
          provider: 'local',
          meta: { width, height, variant: i },
        })
      );
    }
    return results;
  }

  if (!cfg.configured) {
    throw new Error(
      `图像生成 API 未配置。请在服务端环境变量里设置 ARK_API_KEY（当前 provider=${cfg.provider}）。`
    );
  }

  const body = {
    model: cfg.model,
    prompt,
    size: cfg.size,
    response_format: 'url',
    watermark: false,
  };
  const response = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`图像生成失败（HTTP ${response.status}）：${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const items = payload?.data || [];
  const results = [];
  for (const item of items) {
    let buffer = null;
    if (item.b64_json) buffer = Buffer.from(item.b64_json, 'base64');
    else if (item.url) {
      const fileResponse = await fetch(item.url);
      if (fileResponse.ok) buffer = Buffer.from(await fileResponse.arrayBuffer());
    }
    if (!buffer) continue;
    results.push(
      await storeVisual({
        world,
        prompt,
        buffer,
        provider: cfg.provider,
        meta: { model: cfg.model, request: { size: cfg.size } },
      })
    );
  }
  if (!results.length) throw new Error('图像生成接口没有返回可用图片。');
  return results;
}

/* ------------------------------------------------------------------ *
 * 豆包（方舟）一次请求只返回一张图，所以后台点“生成 3 张候选”时
 * 这里会真的请求 3 次，而不是只出一张。
 * ------------------------------------------------------------------ */
const __generateVisualsImpl = generateVisuals;

generateVisuals = async function generateVisualsCounted({ world, prompt, count = 3 } = {}) {
  const cfg = imageProviderConfig();
  const total = Math.max(1, Math.min(4, Number(count) || 1));
  if (cfg.provider === 'local') return __generateVisualsImpl({ world, prompt, count: total });

  const rows = [];
  let lastError = null;
  for (let i = 0; i < total; i++) {
    try {
      rows.push(...(await __generateVisualsImpl({ world, prompt, count: 1 })));
    } catch (error) {
      lastError = error;
      break;
    }
  }
  if (!rows.length && lastError) throw lastError;
  return rows;
};

/* ------------------------------------------------------------------ *
 * 生成的图（豆包返回 JPEG）存成 .png 名字不对，这里按真实格式改名并同步数据库。
 * 浏览器能嗅探所以一直能用，但 MIME 类型是错的，工具也读不了。
 * ------------------------------------------------------------------ */
const __storeVisualImpl = storeVisual;

storeVisual = async function storeVisualWithRealExtension(input) {
  const row = await __storeVisualImpl(input);
  try {
    const sharp = (await import('sharp')).default;
    const abs = path.join(VISUAL_DIR, row.path);
    const meta = await sharp(abs).metadata();
    const actual = meta.format === 'jpeg' ? 'jpg' : meta.format === 'webp' ? 'webp' : 'png';
    if (actual === 'png' || !row.path.endsWith('.png')) return row;
    const nextPath = row.path.replace(/\.png$/, `.${actual}`);
    fs.renameSync(abs, path.join(VISUAL_DIR, nextPath));
    run('UPDATE visual_assets SET path = ? WHERE id = ?', nextPath, row.id);
    return get('SELECT * FROM visual_assets WHERE id = ?', row.id);
  } catch {
    return row;
  }
};

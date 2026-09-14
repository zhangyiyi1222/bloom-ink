import zlib from 'node:zlib';

/** 读 PNG（8 位 RGB/RGBA/灰度），返回像素；自检脚本用它来判断“画面到底画出了什么”。 */
export function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  let bitDepth = 8;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) return null;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) return null;

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[pos++];
      const left = x >= channels ? out[rowStart + x - channels] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[prevStart + x - channels] : 0;
      let pixel = value;
      if (filter === 1) pixel += left;
      else if (filter === 2) pixel += up;
      else if (filter === 3) pixel += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        pixel += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[rowStart + x] = pixel & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

function luminance(r, g, b) {
  const f = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** 某个矩形区域里的亮度分布（p05 近似文字色，p95 近似底色）。 */
export function regionStats(png, { x0 = 0, y0 = 0, x1, y1 } = {}) {
  const { width, height, channels, data } = png;
  const right = Math.min(width, x1 ?? width);
  const bottom = Math.min(height, y1 ?? height);
  const lums = [];
  for (let y = Math.max(0, y0); y < bottom; y++) {
    for (let x = Math.max(0, x0); x < right; x++) {
      const index = y * width * channels + x * channels;
      const r = data[index];
      const g = channels > 1 ? data[index + 1] : r;
      const b = channels > 1 ? data[index + 2] : r;
      lums.push(luminance(r, g, b));
    }
  }
  lums.sort((a, b) => a - b);
  const at = (p) => lums[Math.min(lums.length - 1, Math.floor(lums.length * p))];
  const bg = at(0.95);
  const fg = at(0.03);
  return {
    samples: lums.length,
    p03: +at(0.03).toFixed(3),
    p50: +at(0.5).toFixed(3),
    p95: +at(0.95).toFixed(3),
    contrast: +((bg + 0.05) / (fg + 0.05)).toFixed(2),
  };
}

/* 对比度：用页面上真实的文字颜色，去比“文字背后那片底色”的实测亮度。 */
function relativeLuminance(hex) {
  const clean = String(hex).replace('#', '');
  const channel = (v) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * channel(clean.slice(0, 2)) + 0.7152 * channel(clean.slice(2, 4)) + 0.0722 * channel(clean.slice(4, 6)));
}
function toHex(rgb) {
  const numbers = String(rgb).match(/\d+/g) || [];
  return `#${numbers.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}
function contrastAgainst(fg, bgLuminance) {
  const f = relativeLuminance(toHex(fg));
  const light = Math.max(f, bgLuminance);
  const dark = Math.min(f, bgLuminance);
  return +((light + 0.05) / (dark + 0.05)).toFixed(2);
}

/* ------------------------------------------------------------------ *
 * 补充：统计“明显比底色暗”的像素比例。
 * 中文文字在页面上是稀疏的（占不了区域面积的 3%），
 * 用百分位判断“有没有画出字”会误判；用元素自己的方框量深色像素比例才准。
 * ------------------------------------------------------------------ */
const __regionStatsBase = regionStats;

regionStats = function regionStatsWithDarkRatio(png, box = {}) {
  const base = __regionStatsBase(png, box);
  const { width, height, channels, data } = png;
  const x0 = Math.max(0, box.x0 ?? 0);
  const y0 = Math.max(0, box.y0 ?? 0);
  const x1 = Math.min(width, box.x1 ?? width);
  const y1 = Math.min(height, box.y1 ?? height);
  let dark = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = y * width * channels + x * channels;
      const r = data[index];
      const g = channels > 1 ? data[index + 1] : r;
      const b = channels > 1 ? data[index + 2] : r;
      if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55) dark += 1;
      total += 1;
    }
  }
  return { ...base, darkRatio: +(dark / Math.max(1, total)).toFixed(4) };
};

/* ------------------------------------------------------------------ *
 * darkRatio 换个更通用的定义：与“底色”（中位亮度）差异明显的像素比例。
 * 这样亮底黑字、暗底浅字都能用它判断“文字到底有没有画出来”。
 * ------------------------------------------------------------------ */
const __regionStatsBeforeContrast = regionStats;

regionStats = function regionStatsWithContrast(png, box = {}) {
  const base = __regionStatsBeforeContrast(png, box);
  const { width, height, channels, data } = png;
  const x0 = Math.max(0, box.x0 ?? 0);
  const y0 = Math.max(0, box.y0 ?? 0);
  const x1 = Math.min(width, box.x1 ?? width);
  const y1 = Math.min(height, box.y1 ?? height);
  const median = base.p50;
  let off = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = y * width * channels + x * channels;
      const r = data[index];
      const g = channels > 1 ? data[index + 1] : r;
      const b = channels > 1 ? data[index + 2] : r;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (Math.abs(lum - median) > 0.25) off += 1;
      total += 1;
    }
  }
  return { ...base, darkRatio: +(off / Math.max(1, total)).toFixed(4) };
};

/* 0.25 对短标题（字少、覆盖面积小）偏严，改成 0.18：仍然只统计“明显不同于底色”的像素，
   但能把中文笔画与抗锯齿边缘都算进去。 */
const __regionStatsBeforeTolerance = regionStats;

regionStats = function regionStatsWithTolerance(png, box = {}) {
  const base = __regionStatsBeforeTolerance(png, box);
  const { width, height, channels, data } = png;
  const x0 = Math.max(0, box.x0 ?? 0);
  const y0 = Math.max(0, box.y0 ?? 0);
  const x1 = Math.min(width, box.x1 ?? width);
  const y1 = Math.min(height, box.y1 ?? height);
  const median = base.p50;
  let off = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = y * width * channels + x * channels;
      const r = data[index];
      const g = channels > 1 ? data[index + 1] : r;
      const b = channels > 1 ? data[index + 2] : r;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (Math.abs(lum - median) > 0.18) off += 1;
      total += 1;
    }
  }
  return { ...base, darkRatio: +(off / Math.max(1, total)).toFixed(4) };
};

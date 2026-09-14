import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import anchor from 'markdown-it-anchor';
import attrs from 'markdown-it-attrs';
import hljs from 'highlight.js';
import katex from 'katex';

/* ------------------------------------------------------------------ *
 * 正文渲染器：后台预览与前台文章页共用同一份实现，保证“所见即所得”。
 * 设计约束：
 *  - 内容是纯 Markdown，可迁移、可导出，不锁死在专有结构里。
 *  - 禁用原始 HTML（html:false），因此不存在任意 HTML 注入面。
 *  - 特殊能力（视频 / 音频 / 嵌入 / 图组 / 宽图）都用 Markdown 语法表达，
 *    在别的渲染器里最差也只是退化成链接。
 * ------------------------------------------------------------------ */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|flac|oga)$/i;

const EMBED_HOSTS = [
  { re: /^(?:https?:)?\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]+)/i, build: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}` },
  { re: /^(?:https?:)?\/\/youtu\.be\/([\w-]+)/i, build: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}` },
  { re: /^(?:https?:)?\/\/(?:www\.)?bilibili\.com\/video\/(BV[\w]+|av\d+)/i, build: (m) => `https://player.bilibili.com/player.html?bvid=${m[1]}&autoplay=0&high_quality=1` },
  { re: /^(?:https?:)?\/\/player\.bilibili\.com\/player\.html\?([^\s]+)$/i, build: (m) => `https://player.bilibili.com/player.html?${m[1]}` },
  { re: /^(?:https?:)?\/\/vimeo\.com\/(\d+)/i, build: (m) => `https://player.vimeo.com/video/${m[1]}` },
];

export function resolveEmbed(url) {
  if (!url) return null;
  for (const host of EMBED_HOSTS) {
    const m = String(url).match(host.re);
    if (m) return host.build(m);
  }
  return null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

/** 媒体尺寸索引由外部注入（渲染时用来写 width/height，避免图片加载时页面跳动）。 */
let dimensionIndex = new Map();
export function setDimensionIndex(map) {
  dimensionIndex = map instanceof Map ? map : new Map();
}

function normalizeSrc(src) {
  return String(src || '').trim();
}

function lookupSize(src) {
  const key = normalizeSrc(src).replace(/^https?:\/\/[^/]+/, '');
  return dimensionIndex.get(key) || null;
}

function mediaKind(src) {
  const clean = normalizeSrc(src).split(/[?#]/)[0];
  if (VIDEO_EXT.test(clean)) return 'video';
  if (AUDIO_EXT.test(clean)) return 'audio';
  return 'image';
}

function renderFigure({ kind, src, alt, caption, classes }) {
  const classList = ['md-figure'];
  if (classes.includes('wide')) classList.push('md-figure--wide');
  if (classes.includes('full')) classList.push('md-figure--full');
  if (kind === 'audio') classList.push('md-figure--audio');

  const attrsStr = classList.map((c) => ` class="${c}"`).join('');
  let media = '';
  if (kind === 'video') {
    media = `<video controls preload="metadata" playsinline src="${escapeAttr(src)}"></video>`;
  } else if (kind === 'audio') {
    media = `<audio controls preload="metadata" src="${escapeAttr(src)}"></audio>`;
  } else {
    const size = lookupSize(src);
    const dims = size && size.width && size.height
      ? ` width="${size.width}" height="${size.height}"`
      : '';
    media = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt || '')}" loading="lazy" decoding="async"${dims}>`;
  }
  const cap = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure${attrsStr}>${media}${cap}</figure>`;
}

function mathPlugin(md) {
  function mathInline(state, silent) {
    const start = state.pos;
    if (state.src[start] !== '$' || state.src[start + 1] === '$') return false;
    let pos = start + 1;
    let closed = false;
    while (pos < state.posMax) {
      const ch = state.src[pos];
      if (ch === '\\') {
        pos += 2;
        continue;
      }
      if (ch === '$') {
        closed = true;
        break;
      }
      pos++;
    }
    if (!closed || pos === start + 1 || state.src[pos + 1] === '$') return false;
    const content = state.src.slice(start + 1, pos);
    if (!content.trim() || content !== content.trim() || content.includes('\n')) return false;
    if (/^\d+$/.test(content)) return false;
    if (silent) return true;
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
    state.pos = pos + 1;
    return true;
  }

  function mathBlock(state, startLine, endLine, silent) {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max);
    if (!line.startsWith('$$')) return false;

    let nextLine = startLine;
    let content = '';
    let done = false;
    const first = line.slice(2);
    const firstClose = first.indexOf('$$');
    if (firstClose >= 0) {
      content = first.slice(0, firstClose);
      done = true;
    } else {
      if (first.trim()) content = first;
      for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
        const s = state.bMarks[nextLine] + state.tShift[nextLine];
        const m = state.eMarks[nextLine];
        const text = state.src.slice(s, m);
        const idx = text.indexOf('$$');
        if (idx >= 0) {
          const head = text.slice(0, idx);
          if (head.trim()) content += (content ? '\n' : '') + head;
          done = true;
          break;
        }
        content += (content ? '\n' : '') + text;
      }
    }
    if (!done) return false;
    if (silent) return true;
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content.trim();
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  }

  md.inline.ruler.after('escape', 'math_inline', mathInline);
  md.block.ruler.after('blockquote', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="md-math">${katex.renderToString(tokens[idx].content, {
      displayMode: false,
      throwOnError: false,
      strict: false,
      output: 'html',
    })}</span>`;

  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="md-math-block">${katex.renderToString(tokens[idx].content, {
      displayMode: true,
      throwOnError: false,
      strict: false,
      output: 'html',
    })}</div>`;
}

/** 段落级的媒体后处理：图组、嵌入视频、宽图属性。 */
function mediaBlocksPlugin(md) {
  md.core.ruler.after('inline', 'media_blocks', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'paragraph_open') continue;
      const inline = tokens[i + 1];
      if (!inline || inline.type !== 'inline') continue;
      const children = inline.children || [];

      const paragraphClasses = (token.attrGet('class') || '').split(/\s+/).filter(Boolean);

      // 纯链接段落 + 可嵌入地址 → 响应式 iframe
      if (children.length === 3 && children[0].type === 'link_open' && children[2].type === 'link_close') {
        const embed = resolveEmbed(children[0].attrGet('href'));
        if (embed) {
          const open = new state.Token('embed_open', 'div', 1);
          open.attrSet('class', 'md-embed');
          const iframe = new state.Token('embed_frame', 'iframe', 0);
          iframe.attrSet('src', embed);
          iframe.attrSet('loading', 'lazy');
          iframe.attrSet('allowfullscreen', 'true');
          iframe.attrSet('referrerpolicy', 'no-referrer');
          iframe.attrSet('frameborder', '0');
          iframe.attrSet(
            'allow',
            'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture'
          );
          iframe.block = true;
          const close = new state.Token('embed_close', 'div', -1);
          tokens.splice(i, 3, open, iframe, close);
          i += 2;
          continue;
        }
      }

      // 纯图片段落：把段落上的 {.wide} 之类传给图片；2–3 张图自动组成图组
      const mediaTokens = children.filter((t) => t.type === 'image');
      if (mediaTokens.length === 0) continue;
      const meaningful = children.filter(
        (t) => t.type !== 'text' || t.content.trim() !== ''
      );
      const onlySoftBreaks = meaningful.every((t) => t.type === 'image' || t.type === 'softbreak');
      if (!onlySoftBreaks) continue;

      for (const media of mediaTokens) {
        if (paragraphClasses.length && !media.attrGet('class')) {
          media.attrSet('class', paragraphClasses.join(' '));
        }
      }
      if (mediaTokens.length > 1 && mediaTokens.length <= 3) {
        token.attrJoin('class', 'md-gallery');
        token.attrSet('data-count', String(mediaTokens.length));
        const close = tokens[i + 2];
        if (close && close.type === 'paragraph_close') close.attrJoin('class', 'md-gallery');
      }
    }
    return true;
  });
}

function highlight(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, lang };
    } catch {
      /* fall through */
    }
  }
  return { html: escapeHtml(code), lang: lang || '' };
}

export const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
  quotes: '“”‘’',
});

md.use(footnote);
md.use(attrs, { allowedAttributes: ['id', 'class'] });
md.use(anchor, { permalink: false, slugify: (s) => slugifyHeading(s) });
md.use(mathPlugin);
md.use(mediaBlocksPlugin);

/* 标题层级下移一级：文章标题是 h1，正文里的 # 从 h2 开始。 */
for (const [from, to] of [['h1', 'h2'], ['h2', 'h3'], ['h3', 'h4'], ['h4', 'h5'], ['h5', 'h6'], ['h6', 'h6']]) {
  const original = md.renderer.rules[`${from}_open`] || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules[`${from}_open`] = (tokens, idx, options, env, self) => {
    tokens[idx].tag = to;
    return original(tokens, idx, options, env, self);
  };
  const originalClose = md.renderer.rules[`${from}_close`] || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules[`${from}_close`] = (tokens, idx, options, env, self) => {
    tokens[idx].tag = to;
    return originalClose(tokens, idx, options, env, self);
  };
}

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const info = token.info ? token.info.trim() : '';
  const lang = info.split(/\s+/)[0] || '';
  const { html, lang: usedLang } = highlight(token.content, lang);
  const label = usedLang || 'text';
  return `<div class="md-code" data-lang="${escapeAttr(label)}"><div class="md-code__bar"><span class="md-code__lang">${escapeHtml(
    label
  )}</span><button type="button" class="md-code__copy" data-copy>复制</button></div><pre class="md-code__pre"><code class="hljs language-${escapeAttr(
    label
  )}">${html}</code></pre></div>`;
};

md.renderer.rules.code_block = (tokens, idx) => {
  const { html } = highlight(tokens[idx].content, '');
  return `<div class="md-code"><div class="md-code__bar"><span class="md-code__lang">text</span><button type="button" class="md-code__copy" data-copy>复制</button></div><pre class="md-code__pre"><code class="hljs">${html}</code></pre></div>`;
};

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  const alt = token.content || '';
  const caption = token.attrGet('title') || '';
  const classes = (token.attrGet('class') || '').split(/\s+/).filter(Boolean);
  return renderFigure({ kind: mediaKind(src), src, alt, caption, classes });
};

md.renderer.rules.table_open = () => '<div class="md-table-wrap"><table>';
md.renderer.rules.table_close = () => '</table></div>';

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  if (/^(https?:)?\/\//i.test(href)) {
    token.attrJoin('class', 'md-link--ext');
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.hr = () => '<hr class="md-hr">';

md.renderer.rules.footnote_ref = (tokens, idx, options, env, self) => {
  const id = Number(tokens[idx].meta.id + 1);
  let refid = `fn${id}`;
  if (tokens[idx].meta.subId > 0) refid += `:${tokens[idx].meta.subId}`;
  return `<sup class="md-fn-ref" id="fnref${id}"><a href="#fn${id}" role="doc-noteref">${id}</a></sup>`;
};

export function slugifyHeading(text) {
  const base = String(text)
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'section';
}

/** 渲染正文 HTML。 */
export function renderMarkdown(source) {
  const text = String(source || '');
  if (!text.trim()) return '';
  return md.render(text);
}

/** 从 Markdown 提取纯文本，用于搜索索引、字数统计和 SEO 摘要。 */
export function markdownToPlainText(source) {
  const text = String(source || '');
  if (!text.trim()) return '';
  const tokens = md.parse(text, {});
  const out = [];
  const walk = (list) => {
    for (const token of list) {
      if (token.type === 'inline') {
        for (const child of token.children || []) {
          if (child.type === 'text' || child.type === 'code_inline') out.push(child.content);
          else if (child.type === 'softbreak' || child.type === 'hardbreak') out.push(' ');
          else if (child.type === 'image') out.push(child.content || '');
        }
      } else if (token.type === 'fence' || token.type === 'code_block') {
        out.push(token.content);
      } else if (token.type === 'html_block') {
        out.push('');
      }
      if (token.children && token.type !== 'inline') walk(token.children);
    }
  };
  walk(tokens);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

export function countWords(source) {
  const plain = markdownToPlainText(source);
  const cjk = (plain.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const latin = (plain.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}

export function excerptFrom(source, length = 160) {
  const plain = markdownToPlainText(source);
  if (plain.length <= length) return plain;
  return `${plain.slice(0, length)}…`;
}

export function hasMath(source) {
  const text = String(source || '');
  return /\$\$[\s\S]+?\$\$/.test(text) || /\$[^$\n]+\$/.test(text);
}

export function extractMediaPaths(source) {
  const found = new Set();
  const re = /!\[[^\]]*\]\(([^)\s]+)/g;
  let m;
  while ((m = re.exec(String(source || '')))) found.add(m[1]);
  return [...found];
}

/* ------------------------------------------------------------------ *
 * iframe 必须显式闭合。
 * 否则按 HTML 规则，浏览器会把后面的整篇文章当成 iframe 的内容吞进
 * 去，页面看起来“写到一半就没了”。
 * ------------------------------------------------------------------ */
md.renderer.rules.embed_frame = (tokens, idx) => {
  const attrs = (tokens[idx].attrs || [])
    .map(([key, value]) => ` ${key}="${escapeAttr(value == null ? '' : value)}"`)
    .join('');
  return `<iframe${attrs}></iframe>`;
};

/* ------------------------------------------------------------------ *
 * 图片渲染（修正版）
 *  1. class 只能输出一个属性，之前每个 class 各写一个 class="…",
 *     浏览器只认第一个，于是 {.wide} / {.full} 完全不生效。
 *  2. 同时把“只含图片的段落”换成 div：<p> 里不能放 <figure>。
 * ------------------------------------------------------------------ */
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  const alt = token.content || '';
  const caption = token.attrGet('title') || '';
  const classes = (token.attrGet('class') || '').split(/\s+/).filter(Boolean);
  const classList = ['md-figure'];
  if (classes.includes('wide')) classList.push('md-figure--wide');
  if (classes.includes('full')) classList.push('md-figure--full');
  const kind = mediaKind(src);
  if (kind === 'audio') classList.push('md-figure--audio');

  let media = '';
  if (kind === 'video') {
    media = `<video controls preload="metadata" playsinline src="${escapeAttr(src)}"></video>`;
  } else if (kind === 'audio') {
    media = `<audio controls preload="metadata" src="${escapeAttr(src)}"></audio>`;
  } else {
    const size = lookupSize(src);
    const dims =
      size && size.width && size.height ? ` width="${size.width}" height="${size.height}"` : '';
    media = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async"${dims}>`;
  }
  const cap = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure class="${classList.join(' ')}">${media}${cap}</figure>`;
};

md.core.ruler.after('media_blocks', 'media_wrappers', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open.type !== 'paragraph_open') continue;
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue;
    const children = inline.children || [];
    const hasImage = children.some((child) => child.type === 'image');
    if (!hasImage) continue;
    const onlyMedia = children.every(
      (child) => child.type === 'image' || child.type === 'softbreak' || (child.type === 'text' && child.content.trim() === '')
    );
    if (!onlyMedia) continue;
    open.tag = 'div';
    close.tag = 'div';
    open.attrJoin('class', 'md-media');
  }
  return true;
});

/* ------------------------------------------------------------------ *
 * 最后一道：属性插件（{.wide} / {.full}）是在 core 规则链的后面才跑的，
 * 所以“只含图片的段落”要等它跑完再判断：能转成 div 的转掉（<p> 里不能放
 * <figure>），同时把多余在闭合标签上的属性清掉。
 * ------------------------------------------------------------------ */
md.core.ruler.push('media_wrappers_final', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'paragraph_close') {
      token.attrs = null;
      continue;
    }
    if (token.type !== 'paragraph_open') continue;
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue;
    const children = inline.children || [];
    if (!children.some((child) => child.type === 'image')) continue;
    const onlyMedia = children.every(
      (child) =>
        child.type === 'image' ||
        child.type === 'softbreak' ||
        (child.type === 'text' && child.content.trim() === '')
    );
    if (!onlyMedia) continue;
    const paragraphClasses = (token.attrGet('class') || '').split(/\s+/).filter(Boolean);
    token.tag = 'div';
    close.tag = 'div';
    token.attrJoin('class', 'md-media');
    for (const child of children) {
      if (child.type !== 'image' || child.attrGet('class')) continue;
      const inherited = paragraphClasses.filter((cls) => cls !== 'md-media');
      if (inherited.length) child.attrSet('class', inherited.join(' '));
    }
  }
  return true;
});

/* ------------------------------------------------------------------ *
 * 标题层级下移一级（修正版）
 * markdown-it 的标题 token 类型是 heading_open / heading_close，
 * 不是 h1_open，所以之前按标签名注册的规则永远不会被调用。
 * 文章大标题已经是 h1，正文里的 # 必须从 h2 开始。
 * ------------------------------------------------------------------ */
const HEADING_SHIFT = { h1: 'h2', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6', h6: 'h6' };

md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.tag = HEADING_SHIFT[token.tag] || token.tag;
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.heading_close = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.tag = HEADING_SHIFT[token.tag] || token.tag;
  return self.renderToken(tokens, idx, options);
};

/* class 去重（规则叠加可能把 md-media 加两次） */
md.core.ruler.push('class_dedupe', (state) => {
  for (const token of state.tokens) {
    const value = typeof token.attrGet === 'function' ? token.attrGet('class') : null;
    if (!value) continue;
    const unique = [...new Set(value.split(/\s+/).filter(Boolean))];
    token.attrSet('class', unique.join(' '));
  }
  return true;
});

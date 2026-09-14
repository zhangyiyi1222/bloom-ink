import fs from 'node:fs';
import path from 'node:path';
import { createArticle, getArticleBySlug, listArticles } from '../src/server/articles.mjs';
import { saveUpload } from '../src/server/media.mjs';
import { run } from '../src/server/db.mjs';
import { rebuildIndex } from '../src/server/search.mjs';

/* =====================================================================
   把 zhangzhongwei.top（Hugo）的文章整篇搬过来
   用法：
     node scripts/import-hugo.mjs "D:/work/codex/project1/content" --section log
     node scripts/import-hugo.mjs ... --wipe     先清掉演示文章（保留组件测试那篇）

   做的事：
     · 读 front matter（title / date / categories / draft）
     · 把同目录的图片、录音、视频搬进媒体库
     · 把 {{< audio >}} / {{< video >}} / {{< note >}} 换成新站的 Markdown
     · 文章落在 --section 指定的栏目（默认 log = 归心）；重复的 slug 会跳过
   ===================================================================== */

const args = process.argv.slice(2);
const contentDir = args.find((a) => !a.startsWith('--'));
const sectionIndex = args.indexOf('--section');
const section = sectionIndex >= 0 && args[sectionIndex + 1] ? args[sectionIndex + 1] : 'log';
const wipe = args.includes('--wipe');

if (!contentDir || !fs.existsSync(contentDir)) {
  console.error('用法：node scripts/import-hugo.mjs <Hugo 的 content 目录> [--section log] [--wipe]');
  process.exit(1);
}

if (wipe) {
  const removed = run("DELETE FROM articles WHERE slug <> 'component-test'");
  console.log(`已清掉演示文章（保留组件测试那篇）：约 ${removed.changes ?? 0} 篇`);
}

const MEDIA_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp',
  '.mp4', '.mov', '.webm', '.m4v',
  '.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg',
]);

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.ogg': 'audio/ogg',
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** 只认最简单的 YAML：key: value、key: [a, b]、key: 后面跟 - 列表 */
function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };

  const data = {};
  let lastKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && lastKey) {
      if (!Array.isArray(data[lastKey])) data[lastKey] = data[lastKey] ? [data[lastKey]] : [];
      data[lastKey].push(listItem[1].replace(/^["']|["']$/g, '').trim());
      continue;
    }

    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    lastKey = kv[1];
    const value = kv[2].trim();
    if (!value) {
      data[lastKey] = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[lastKey] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.replace(/^["']|["']$/g, '').trim())
        .filter(Boolean);
    } else {
      data[lastKey] = value.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: text.slice(match[0].length) };
}

/** Hugo 短代码 → 新站 Markdown */
function convertBody(body, mediaMap) {
  let out = body;

  out = out.replace(/\{\{<\s*(audio|video)\s+src="([^"]+)"[^>]*>\}\}/g, (full, kind, src) => {
    const url = mediaMap.get(path.basename(src));
    if (!url) return full;
    return `![${kind === 'audio' ? '录音' : '视频'}](${url})`;
  });

  out = out.replace(/\{\{<\s*note\s*>\}\}([\s\S]*?)\{\{<\s*\/note\s*>\}\}/g, (full, inner) =>
    inner
      .trim()
      .split(/\r?\n/)
      .map((line) => (line.trim() ? `> ${line.trim()}` : '>'))
      .join('\n')
  );

  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (full, alt, src) => {
    if (/^(https?:)?\/\//.test(src) || src.startsWith('/')) return full;
    const url = mediaMap.get(path.basename(decodeURIComponent(src)));
    if (!url) return full;
    return `![${alt}](${url})`;
  });

  out = out.replace(/\{\{[<%][\s\S]*?[>%]\}\}/g, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

const files = walk(contentDir).filter(
  (file) => file.endsWith('.md') && !file.endsWith('_index.md') && path.basename(path.dirname(file)) !== 'content'
);

let imported = 0;
let skipped = 0;
let mediaCount = 0;
let mediaBytes = 0;

for (const file of files) {
  const { data, body } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(file);
  const dirName = path.basename(dir);
  const title = String(data.title || dirName).replace(/^["']|["']$/g, '').trim();
  if (!title) {
    skipped += 1;
    continue;
  }

  const slug = dirName.replace(/^\d+[-_]/, '').trim() || title;
  if (getArticleBySlug(section, slug)) {
    skipped += 1;
    continue;
  }

  const mediaMap = new Map();
  for (const sibling of fs.readdirSync(dir)) {
    const full = path.join(dir, sibling);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(sibling).toLowerCase();
    if (!MEDIA_EXT.has(ext)) continue;
    const buffer = fs.readFileSync(full);
    const row = await saveUpload({
      buffer,
      originalName: sibling,
      mime: MIME[ext] || 'application/octet-stream',
      alt: title,
    });
    mediaMap.set(sibling, `/uploads/${row.path}`);
    mediaMap.set(path.basename(sibling, path.extname(sibling)), `/uploads/${row.path}`);
    mediaCount += 1;
    mediaBytes += buffer.length;
  }

  const content = convertBody(body, mediaMap);
  const categories = Array.isArray(data.categories)
    ? data.categories
    : data.categories
      ? [data.categories]
      : [];
  const publishedAt = data.date ? new Date(String(data.date)) : new Date();
  const isDraft = data.draft !== undefined && String(data.draft).toLowerCase() !== 'false';

  createArticle({
    title,
    slug,
    section,
    content,
    status: isDraft ? 'draft' : 'published',
    published_at: Number.isNaN(publishedAt.getTime()) ? new Date().toISOString() : publishedAt.toISOString(),
    tags: categories.join(','),
    seo_description: content.replace(/[#>*`\[\]()!]/g, ' ').replace(/\s+/g, ' ').slice(0, 110),
  });
  imported += 1;
}

const indexed = rebuildIndex();
const total = listArticles({ limit: 1 }).total;

console.log('');
console.log('导入完成：');
console.log(`  新导入：${imported} 篇（跳过 ${skipped} 篇）`);
console.log(`  搬进媒体库：${mediaCount} 个文件，约 ${(mediaBytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  现在共有文章：${total} 篇，搜索索引 ${indexed} 条`);
console.log(`  落在栏目：${section}`);

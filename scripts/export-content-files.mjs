import fs from 'node:fs';
import path from 'node:path';
import { listArticles, getArticle } from '../src/server/articles.mjs';
import { DATA_DIR } from '../src/server/config.mjs';

/* =====================================================================
   第 1 步：把数据库里的内容落成"仓库里的文件"
     content/<栏目>/<日期>-<slug>.md   ← 文章（Markdown + front matter）
     media/<原路径>                    ← 图片 / 录音 / 视频

   文章正文里的 /uploads/… 会改写成 /media/…，这样静态站发出去以后
   图片路径是对的（域名根目录下 /media/... 直接可访问）。

   用法：node scripts/export-content-files.mjs
   ===================================================================== */

const CONTENT_DIR = path.resolve('content');
const MEDIA_DIR = path.resolve('media');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyTree(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyTree(src, dest);
    else {
      fs.copyFileSync(src, dest);
      count += 1;
    }
  }
  return count;
}

function frontMatter(article) {
  const lines = [
    '---',
    `title: ${article.title}`,
    `section: ${article.section}`,
    `slug: ${article.slug}`,
    `date: ${(article.published_at || '').slice(0, 19).replace('T', ' ')}`,
    `status: ${article.status}`,
    `tags: ${article.tags || ''}`,
    `description: ${(article.seo_description || '').replace(/\n/g, ' ')}`,
    '---',
    '',
  ];
  return lines.join('\n');
}

console.log('正在把内容落成文件…');

rmrf(CONTENT_DIR);
rmrf(MEDIA_DIR);
fs.mkdirSync(CONTENT_DIR, { recursive: true });

const { rows, total } = listArticles({ limit: 5000 });
let written = 0;

for (const row of rows) {
  const article = getArticle(row.id);
  if (!article) continue;
  const dir = path.join(CONTENT_DIR, article.section);
  fs.mkdirSync(dir, { recursive: true });

  const date = (article.published_at || '').slice(0, 10) || '1970-01-01';
  const safeSlug = article.slug.replace(/[\\/:*?"<>|]/g, '-');
  const file = path.join(dir, `${date}-${safeSlug}.md`);
  const body = String(article.content || '').replace(/\(\/uploads\//g, '(/media/');
  fs.writeFileSync(file, `${frontMatter(article)}${body}\n`);
  written += 1;
}

const mediaCount = copyTree(UPLOAD_DIR, MEDIA_DIR);

const size = (() => {
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else bytes += fs.statSync(full).size;
    }
  };
  if (fs.existsSync(MEDIA_DIR)) walk(MEDIA_DIR);
  return (bytes / 1024 / 1024).toFixed(1);
})();

console.log('');
console.log('第 1 步完成：');
console.log(`  content/  写入 ${written} 篇文章（数据库里共 ${total} 篇）`);
console.log(`  media/    复制 ${mediaCount} 个媒体文件，约 ${size} MB`);
console.log('  正文里的图片地址已从 /uploads/… 改成 /media/…');
console.log('');
console.log('下一步：让网站直接读 content/ 里的 Markdown，再做「填令牌就能写」的编辑页。');

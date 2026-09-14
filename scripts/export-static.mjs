import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/server/app.mjs';
import { getSettings } from '../src/server/settings.mjs';
import { listArticles } from '../src/server/articles.mjs';
import { DATA_DIR, PORT } from '../src/server/config.mjs';

/* =====================================================================
   把整站"烤"成静态文件，产物放在 docs/（GitHub Pages 可以直接发这个目录）
   用法：
     node scripts/export-static.mjs
   原理：内部起一个服务，用真实前台 renderer 逐个抓取页面，
        所以导出结果和你在本机看到的完全一致。
   注意：静态版只有前台（首页/归档/文章/搜索/RSS/sitemap）。
        写文章的后台仍然在本机跑（不会被导出）。
   ===================================================================== */

const DIST = path.resolve('docs');

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(src, dest);
    else {
      fs.copyFileSync(src, dest);
      count += 1;
    }
  }
  return count;
}

/** 页面地址 → docs 里的文件路径 */
function fileFor(urlPath) {
  const clean = urlPath.split('?')[0];
  if (/\.(xml|json|txt|ico|svg|css|js|png|jpe?g|webp|avif|mp4|m4a|mp3|wav|woff2)$/i.test(clean)) {
    return path.join(DIST, clean);
  }
  const dir = clean.replace(/^\/|\/$/g, '');
  return path.join(DIST, dir, 'index.html');
}

console.log('正在构建静态站（前台）…');

rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });

const app = createApp();
const server = app.listen(Number(PORT) + 1, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${Number(PORT) + 1}`;

const { rows, total } = listArticles({ limit: 5000 });
const urls = ['/', '/origin/', '/self/', '/bloom/', '/log/', '/ink/', '/search/'];
for (const row of rows) urls.push(`/${row.section}/${row.slug}/`);

let pages = 0;
let skipped = 0;
for (const urlPath of urls) {
  const encoded = urlPath.split('/').map((part) => encodeURIComponent(part)).join('/');
  const response = await fetch(`${base}${encoded}`);
  if (!response.ok) {
    skipped += 1;
    continue;
  }
  const target = fileFor(urlPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, await response.text());
  pages += 1;
}

for (const file of [
  '/rss.xml',
  '/log/rss.xml',
  '/sitemap.xml',
  '/robots.txt',
  '/search-index.json',
  '/favicon.ico',
]) {
  const response = await fetch(`${base}${file}`);
  if (!response.ok) continue;
  const target = fileFor(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

const copied = {
  assets: copyDir(path.resolve('public/assets'), path.join(DIST, 'assets')),
  vendor: copyDir(path.resolve('public/vendor'), path.join(DIST, 'vendor')),
  static: copyDir(path.resolve('public/static'), path.join(DIST, 'static')),
  uploads: copyDir(path.join(DATA_DIR, 'uploads'), path.join(DIST, 'uploads')),
  visuals: copyDir(path.join(DATA_DIR, 'visuals'), path.join(DIST, 'visuals')),
};

const domain = (getSettings()['site.domain'] || '')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');
if (domain) fs.writeFileSync(path.join(DIST, 'CNAME'), `${domain}\n`);
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
fs.writeFileSync(
  path.join(DIST, 'README.txt'),
  '这是静态导出的网站（GitHub Pages 直接发这个目录）。\n用 `node scripts/export-static.mjs` 重新生成，不要手改这里的文件。\n'
);

server.close();

let bytes = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else bytes += fs.statSync(full).size;
  }
};
walk(DIST);

console.log('');
console.log(`导出完成 → ${DIST}`);
console.log(`  页面：${pages} 个（跳过 ${skipped} 个草稿/未发布）`);
console.log(`  文章：数据库里共 ${total} 篇，导出文章页 ${rows.length - skipped} 个`);
console.log(
  `  资源：assets ${copied.assets} · vendor ${copied.vendor} · static ${copied.static} · uploads ${copied.uploads} · visuals ${copied.visuals}`
);
console.log(`  体积：约 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
if (domain) console.log(`  自定义域名：${domain}（已写入 docs/CNAME）`);
console.log('');
console.log('下一步：把 docs/ 一起提交推送到 GitHub，然后在仓库里把 Pages 设成「main 分支 / docs 目录」。');

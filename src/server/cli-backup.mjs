import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR, DATA_DIR } from './config.mjs';
import { ZipBuilder } from './zip.mjs';
import { listArticles, getArticle } from './articles.mjs';
import { listMedia } from './media.mjs';
import { getSettings, listSocialLinks } from './settings.mjs';
import { listVisuals } from './visuals.mjs';

/**
 * 完整备份：文章（Markdown）＋媒体原文件＋设置＋视觉素材，打成一个 zip。
 * 用法：npm run backup
 * 结果：data/backups/bloom-ink-YYYYMMDD-HHmmss.zip
 */
const zip = new ZipBuilder();
const rows = listArticles({ limit: 10000 }).rows;

for (const row of rows) {
  const article = getArticle(row.id);
  const front = [
    '---',
    `title: ${article.title}`,
    `slug: ${article.slug}`,
    `section: ${article.section}`,
    `status: ${article.status}`,
    `published_at: ${article.published_at || ''}`,
    `tags: ${article.tags || ''}`,
    `seo_description: ${(article.seo_description || '').replace(/\n/g, ' ')}`,
    '---',
    '',
  ].join('\n');
  zip.add(
    `articles/${article.section}/${(article.published_at || '').slice(0, 10)}-${article.slug}.md`,
    `${front}${article.content}\n`
  );
}

const { rows: mediaRows } = listMedia({ limit: 20000 });
for (const row of mediaRows) {
  const file = path.join(DATA_DIR, 'uploads', row.path);
  if (fs.existsSync(file)) zip.add(`media/${row.path}`, fs.readFileSync(file));
}
zip.add('media.json', JSON.stringify(mediaRows, null, 2));

for (const world of ['bloom', 'ink']) {
  for (const row of listVisuals(world, 500)) {
    const file = path.join(DATA_DIR, 'visuals', row.path);
    if (fs.existsSync(file)) zip.add(`visuals/${world}/${row.path}`, fs.readFileSync(file));
  }
}

zip.add('settings.json', JSON.stringify({ settings: getSettings(), social: listSocialLinks() }, null, 2));
zip.add(
  'README.txt',
  [
    '一个人像一朵花 · 完整备份',
    '',
    'articles/  纯 Markdown 文章，任何静态博客都能直接用',
    'media/     上传的原文件（含自动生成的 webp 与缩略图）',
    'visuals/   BLOOM / INK 基础视觉素材',
    'settings.json  站点设置与社交链接',
    '',
  ].join('\n')
);

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const target = path.join(BACKUP_DIR, `bloom-ink-${stamp}.zip`);
fs.writeFileSync(target, zip.build());
console.log(`备份完成：${target}`);
console.log(`  文章 ${rows.length} 篇 · 媒体 ${mediaRows.length} 个`);

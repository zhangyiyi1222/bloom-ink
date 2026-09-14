import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';
import { ZipBuilder } from './zip.mjs';
import { listArticles, getArticle } from './articles.mjs';

/** 只导出文章：纯 Markdown + 一个索引文件。用法：npm run export */
const zip = new ZipBuilder();
const rows = listArticles({ limit: 10000 }).rows;
const index = [];

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
  const name = `articles/${article.section}/${(article.published_at || '').slice(0, 10)}-${article.slug}.md`;
  zip.add(name, `${front}${article.content}\n`);
  index.push({ title: article.title, section: article.section, published_at: article.published_at, file: name });
}

zip.add('index.json', JSON.stringify(index, null, 2));
const target = path.join(
  DATA_DIR,
  `markdown-export-${new Date().toISOString().slice(0, 10)}.zip`
);
fs.writeFileSync(target, zip.build());
console.log(`导出完成：${target}（${rows.length} 篇）`);

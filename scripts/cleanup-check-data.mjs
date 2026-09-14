import fs from 'node:fs';
import path from 'node:path';
import { run, all } from '../src/server/db.mjs';
import { UPLOAD_DIR } from '../src/server/config.mjs';

/* =====================================================================
   清理自检脚本留下的东西（后台自检会自己建账号、发一篇文章、传一张图）。
   只删这些，不动演示文章、首页照片和豆包生成的基础视觉。
   用法：node scripts/cleanup-check-data.mjs
   ===================================================================== */

const articles = all("SELECT id FROM articles WHERE title LIKE '自检文章%'");
for (const row of articles) run('DELETE FROM articles WHERE id = ?', row.id);

const media = all("SELECT * FROM media WHERE original_name LIKE 'paste-test%'");
for (const row of media) {
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, row.path));
  } catch {
    /* 文件可能已经不在了 */
  }
  if (row.variants) {
    try {
      for (const rel of Object.values(JSON.parse(row.variants))) {
        fs.unlinkSync(path.join(UPLOAD_DIR, rel));
      }
    } catch {
      /* 忽略 */
    }
  }
  run('DELETE FROM media WHERE id = ?', row.id);
}

run('DELETE FROM sessions');
run('DELETE FROM users');

console.log(`已清理：自检文章 ${articles.length} 篇，自检上传 ${media.length} 个，后台账号已清空。`);

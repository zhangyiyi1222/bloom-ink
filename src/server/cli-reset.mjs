import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT, UPLOAD_DIR, imageProviderConfig } from './config.mjs';
import { run, get, nowIso } from './db.mjs';
import { saveUpload } from './media.mjs';
import { seedDemo } from './seed.mjs';

/* =====================================================================
   清空演示数据，重新生成一份干净的验收数据。
   用法：
     npm run reset                    清空全部（含后台账号，之后首次打开 /admin 会引导设置密码）
     npm run reset -- --keep-admin    保留后台账号
   ===================================================================== */

const keepAdmin = process.argv.includes('--keep-admin');
const VISUAL_DIR = path.join(DATA_DIR, 'visuals');
const HOME_PHOTO_DIR = path.join(ROOT, 'public', 'static', 'home');

/** 首页照片上写的那几个字。顺序对应 public/static/home 里的文件顺序，之后可在后台逐张改。 */
const HOME_PHOTO_WORDS = [
  '入花',
  '入世界',
  '入墨',
  '入春',
  '入夜',
  '入光',
  '入海',
  '入山',
  '入梦',
  '入静',
  '入世',
  '入心',
];

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** 首页「晾晒」用的照片：项目自带的样片（public/static/home）装进媒体库，并写上那句话。 */
async function importHomePhotos(logger) {
  if (!fs.existsSync(HOME_PHOTO_DIR)) return 0;
  const files = fs
    .readdirSync(HOME_PHOTO_DIR)
    .filter((name) => /\.(jpe?g|png|webp|avif)$/i.test(name))
    .sort();
  let count = 0;
  for (const [index, name] of files.entries()) {
    const buffer = fs.readFileSync(path.join(HOME_PHOTO_DIR, name));
    const mime = /\.png$/i.test(name)
      ? 'image/png'
      : /\.webp$/i.test(name)
        ? 'image/webp'
        : /\.avif$/i.test(name)
          ? 'image/avif'
          : 'image/jpeg';
    await saveUpload({
      buffer,
      originalName: name,
      mime,
      alt: '首页照片',
      caption: HOME_PHOTO_WORDS[index % HOME_PHOTO_WORDS.length],
    });
    count += 1;
  }
  if (count) logger(`已把 ${count} 张首页照片装进媒体库（每张写了一句，后台可改可删）`);
  return count;
}

console.log('正在清空演示数据…');
run('DELETE FROM article_revisions');
run('DELETE FROM search_index');
run('DELETE FROM articles');
run('DELETE FROM media');
run('DELETE FROM social_links');
run('DELETE FROM visual_assets');
run('DELETE FROM activity_log');
if (!keepAdmin) {
  run('DELETE FROM sessions');
  run('DELETE FROM users');
}
emptyDir(UPLOAD_DIR);
emptyDir(VISUAL_DIR);
console.log('已清空文章、媒体、视觉素材' + (keepAdmin ? '（保留后台账号）' : '与后台账号'));

const provider = imageProviderConfig();
console.log(
  `图像 provider：${provider.provider}${provider.configured ? '' : '（未配置密钥，将用本地程序化生成）'}`
);
console.log(`时间：${nowIso()}`);

const result = await seedDemo({ reset: false, logger: console.log });
await importHomePhotos(console.log);

const mediaCount = get('SELECT COUNT(*) AS n FROM media WHERE deleted_at IS NULL').n;
console.log('');
console.log(`完成：${result.created} 篇文章，索引 ${result.indexed} 条，媒体 ${mediaCount} 个。`);
console.log(
  keepAdmin
    ? '后台账号保持不变。'
    : '后台还没有账号：启动后第一次打开 /admin，会引导你设置密码。'
);

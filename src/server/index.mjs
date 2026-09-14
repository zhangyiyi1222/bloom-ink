import { createApp } from './app.mjs';
import { HOST, PORT, DATA_DIR, DB_FILE } from './config.mjs';
import { rebuildIndex, indexStatus } from './search.mjs';
import { getSettings } from './settings.mjs';
import { userCount } from './auth.mjs';
import fs from 'node:fs';
import path from 'node:path';

const app = createApp();

// 首次启动时：若数据库里还没有搜索索引而已经有已发布文章，自动补建一次。
const status = indexStatus();
if (status.published > 0 && status.indexed === 0) {
  rebuildIndex();
}

app.listen(PORT, HOST, () => {
  const settings = getSettings();
  console.log('');
  console.log(`  ${settings['site.title']} — 已启动`);
  console.log(`  前台：http://${HOST}:${PORT}/`);
  console.log(`  后台：http://${HOST}:${PORT}/admin`);
  console.log(`  数据：${DB_FILE}`);
  console.log(
    `  管理员：${userCount() > 0 ? '已创建' : '尚未创建（首次打开后台会引导设置密码）'}`
  );
  if (!fs.existsSync(path.join(DATA_DIR, 'uploads'))) {
    fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
  }
  console.log('');
});

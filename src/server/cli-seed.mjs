import { seedDemo } from './seed.mjs';
import { DB_FILE } from './config.mjs';

const reset = process.argv.includes('--reset');

console.log(`数据文件：${DB_FILE}`);
console.log(reset ? '正在重建演示数据（会清空现有文章）…' : '正在补充演示数据…');

const result = await seedDemo({ reset, logger: console.log });
console.log('');
console.log('完成。');
console.log(`  新文章：${result.created ?? 0}`);
if (result.componentTestId) {
  console.log(`  组件测试文章：/admin/articles/${result.componentTestId}`);
}
console.log('  现在可以 npm run build && npm start');

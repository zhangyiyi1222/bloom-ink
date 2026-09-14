import fs from 'node:fs';
import path from 'node:path';

/** 把 KaTeX 的样式与字体复制成静态文件，只有含公式的文章才加载。 */
const src = path.resolve('node_modules/katex/dist');
const dest = path.resolve('public/vendor/katex');

if (!fs.existsSync(src)) {
  console.log('[vendor] 未找到 node_modules/katex，跳过。');
  process.exit(0);
}

fs.mkdirSync(path.join(dest, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(src, 'katex.min.css'), path.join(dest, 'katex.min.css'));

const fonts = path.join(src, 'fonts');
if (fs.existsSync(fonts)) {
  for (const file of fs.readdirSync(fonts)) {
    fs.copyFileSync(path.join(fonts, file), path.join(dest, 'fonts', file));
  }
}

// favicon：一朵极简的花
const staticDir = path.resolve('public/static');
fs.mkdirSync(staticDir, { recursive: true });
fs.writeFileSync(
  path.join(staticDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#fffdf9"/>
  <g fill="none" stroke="#c58fa8" stroke-width="1.3">
    <path d="M16 22V12"/>
    <path d="M16 13c-3.4-1.2-5-3.6-4.4-6 2.4-.6 4.8.8 6 3.4"/>
    <path d="M16 13c3.4-1.2 5-3.6 4.4-6-2.4-.6-4.8.8-6 3.4"/>
    <path d="M16 20c-2.6 0-4.6-1.6-5-3.6"/>
  </g>
</svg>
`,
  'utf8'
);

console.log('[vendor] KaTeX 样式与 favicon 已就绪。');

import { generateVisuals, visualUrl } from '../src/server/visuals.mjs';
import { setSetting, getSettings } from '../src/server/settings.mjs';
import { imageProviderConfig } from '../src/server/config.mjs';

/* =====================================================================
   为三个亮色栏目生成「花的状态」背景图
     缘起 = 花芽 · 本真 = 花苞 · 绽放 = 花开
   用法：
     node scripts/gen-sections.mjs           三个都重新生成并采用
     node scripts/gen-sections.mjs origin    只生成某一个
   ===================================================================== */

const SECTIONS = [
  {
    key: 'origin',
    label: '缘起 · 花芽',
    prompt:
      '一枝刚刚破土而出的嫩芽特写，两片舒展的小叶子，清新的嫩绿色，纯白背景，植物小景居中，水彩与水墨结合的质感，轮廓清晰，干净通透，无文字，无人物，横幅构图',
  },
  {
    key: 'self',
    label: '本真 · 花苞',
    prompt:
      '一枝含苞待放的花苞特写，淡淡的花瓣粉色，纯白背景，植物小景居中，水彩与水墨结合的质感，轮廓清晰，干净通透，无文字，无人物，横幅构图',
  },
  {
    key: 'bloom',
    label: '绽放 · 花开',
    prompt:
      '一朵正在盛开的花特写，柔和的花瓣粉色与淡紫色，纯白背景，植物小景居中，水彩与水墨结合的质感，轮廓清晰，干净通透，无文字，无人物，横幅构图',
  },
];

const only = process.argv[2];
const provider = imageProviderConfig();
console.log(`provider：${provider.provider}${provider.configured ? '' : '（未配置）'}`);

for (const section of SECTIONS) {
  if (only && only !== section.key) continue;
  console.log(`\n正在生成 ${section.label}…`);
  const rows = await generateVisuals({ world: section.key, prompt: section.prompt, count: 1 });
  const row = rows[0];
  if (!row) {
    console.log('  没有拿到图。');
    continue;
  }
  setSetting(`section.${section.key}.image`, visualUrl(row));
  console.log(`  已采用 #${row.id} ${visualUrl(row)}`);
}

console.log('\n三个栏目的背景图：');
for (const k of ['origin', 'self', 'bloom']) {
  console.log(`  ${k}: ${getSettings()[`section.${k}.image`] || '（未设置）'}`);
}

import { generateVisuals, listVisuals, activateVisual, visualUrl } from '../src/server/visuals.mjs';
import { setSetting, getSettings } from '../src/server/settings.mjs';
import { imageProviderConfig } from '../src/server/config.mjs';

/* =====================================================================
   用命令行重新生成 BLOOM / INK 的基础视觉（省得进后台点）
   用法：
     node scripts/gen-visuals.mjs bloom            生成 3 张候选（不自动采用）
     node scripts/gen-visuals.mjs bloom --take 1   生成 3 张，并把第 1 张设为当前
     node scripts/gen-visuals.mjs ink --count 2
     node scripts/gen-visuals.mjs bloom --prompt "自己写描述"
   ===================================================================== */

const args = process.argv.slice(2);
const world = args[0] === 'ink' ? 'ink' : 'bloom';
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const count = Number(flag('count', '3')) || 3;
const take = Number(flag('take', '0')) || 0;
const settings = getSettings();
const prompt = flag('prompt', settings[`${world}.prompt`] || world);
const provider = imageProviderConfig();

console.log(`provider：${provider.provider}${provider.configured ? '' : '（未配置）'}`);
console.log(`world：${world}`);
console.log(`prompt：${prompt}`);
console.log('正在生成…');

const rows = await generateVisuals({ world, prompt, count });
console.log(`生成 ${rows.length} 张：`);
for (const row of rows) console.log(`  #${row.id} ${visualUrl(row)} (${row.width}×${row.height})`);

if (take > 0 && rows[take - 1]) {
  const chosen = activateVisual(rows[take - 1].id);
  setSetting(`${world}.image`, visualUrl(chosen));
  console.log(`已把 #${chosen.id} 设为当前 ${world.toUpperCase()} 基础视觉。`);
  console.log(`当前素材库共 ${listVisuals(world, 200).length} 张。`);
} else {
  console.log('没有自动采用（想采用就在后台「视觉」里点“设为当前”，或者加 --take 1）。');
}

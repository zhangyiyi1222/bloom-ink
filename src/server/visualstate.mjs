import { activateVisual, deleteVisual, visualUrl } from './visuals.mjs';
import { setSetting } from './settings.mjs';

/**
 * 激活/删除视觉素材时，把当前使用的图片地址同步进设置里，
 * 这样模板只需要读 settings 就能拿到「当前 BLOOM / INK 基础视觉」。
 */
export function activateVisualWithSettings(id) {
  const row = activateVisual(id);
  if (row) setSetting(`${row.world}.image`, visualUrl(row));
  return row;
}

export function deleteVisualWithSettings(id) {
  const row = deleteVisual(id);
  if (row && row.active) setSetting(`${row.world}.image`, '');
  return row;
}

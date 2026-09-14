import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, setInputSnippet, summarize } from './lib/browser.mjs';
import { encodePng } from '../src/server/png.mjs';

/* =====================================================================
   后台端到端自检
   真的登录 → 新建文章 → 打字 → 粘贴上传图片 → 自动保存 → 预发布预览 →
   发布 → 前台能看到 → 搜索能搜到 → 回收站能恢复
   用法：node scripts/e2e-admin.mjs [baseUrl]
   ===================================================================== */

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const USERNAME = process.env.CHECK_ADMIN_USER || 'admin';
const PASSWORD = process.env.CHECK_ADMIN_PASSWORD || 'bloomink-2026';

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const marker = `自动自检标记${Date.now().toString().slice(-6)}`;
const articleBody = [
  `第一段：${marker}。这一段用来确认编辑器写进去的内容，能原样出现在前台。`,
  '',
  '## 小标题',
  '',
  '> 引用一句话。',
  '',
  '- 列表一',
  '- 列表二',
  '',
  '```js',
  'const bloom = "open";',
  '```',
].join('\n');

const { cdp, chrome } = await launchBrowser();
const shots = [];

try {
  /* 1. 登录 / 初始化 */
  console.log('\n一、登录后台');
  await cdp.goto(`${BASE}/admin`, 1500);
  const needsSetup = await cdp.evaluate(`Boolean(document.querySelector('.login__title')?.textContent.includes('创建'))`);
  await cdp.evaluate(setInputSnippet('.login__panel input[autocomplete="username"]', USERNAME));
  await cdp.evaluate(
    setInputSnippet(
      '.login__panel input[type="password"]',
      PASSWORD
    )
  );
  if (needsSetup) {
    await cdp.evaluate(
      setInputSnippet('.login__panel input[autocomplete="new-password"]:not([type="password"])', PASSWORD)
    );
    // 有些浏览器会把两个密码框都当 password，这里直接给最后一个再赋一次
    await cdp.evaluate(`(() => {
      const inputs = [...document.querySelectorAll('.login__panel input[type="password"]')];
      if (inputs.length < 2) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inputs[1], ${JSON.stringify(PASSWORD)});
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  await cdp.evaluate(`document.querySelector('.login__panel button[type="submit"]').click()`);
  await cdp.waitFor(`Boolean(document.querySelector('.admin-nav'))`, { label: '进入后台' });
  record(needsSetup ? '首次进入：创建管理员成功' : '登录成功', true, USERNAME);
  shots.push(await cdp.screenshot('shots/11-admin-home.png'));

  /* 2. 新建文章 */
  console.log('\n二、新建文章');
  await cdp.evaluate(`[...document.querySelectorAll('.admin-top__right button')].find((b) => b.textContent.includes('新建文章')).click()`);
  await cdp.waitFor(`document.querySelectorAll('.stat').length >= 4`, { label: '选择栏目' });
  await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('.stat')].find((el) => el.textContent.includes('绽放'));
    card.click();
    return true;
  })()`);
  await cdp.waitFor(`Boolean(document.querySelector('.editor'))`, { label: '打开编辑器' });
  const articleId = Number((await cdp.evaluate('location.pathname')).split('/').pop());
  record('新建文章并进入编辑器', Number.isFinite(articleId), `article id = ${articleId}`);

  /* 3. 写标题与正文 */
  console.log('\n三、写作');
  const title = `自检文章·${marker}`;
  await cdp.evaluate(setInputSnippet('.editor__title-input', title));
  await cdp.evaluate(`document.querySelector('.cm-content').focus()`);
  await cdp.send('Input.insertText', { text: articleBody });
  await sleep(600);
  const typed = await cdp.evaluate(`document.querySelector('.cm-content').innerText.includes(${JSON.stringify(marker)})`);
  record('正文写进编辑器', typed, `${articleBody.length} 字符`);

  /* 4. 粘贴上传图片 */
  const png = encodePng(8, 8, (() => {
    const data = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) {
      data[i * 4] = 200;
      data[i * 4 + 1] = 170 + (i % 40);
      data[i * 4 + 2] = 190;
      data[i * 4 + 3] = 255;
    }
    return data;
  })());
  await cdp.evaluate(`(async () => {
    const binary = atob(${JSON.stringify(png.toString('base64'))});
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'paste-test.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector('.cm-content');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await cdp.waitFor(`document.querySelector('.cm-content').innerText.includes('/uploads/')`, {
    timeout: 15000,
    label: '粘贴上传完成',
  });
  const uploaded = await cdp.evaluate(`(() => {
    const text = document.querySelector('.cm-content').innerText;
    const match = text.match(/!\\[[^\\]]*\\]\\(([^)]*uploads[^)]*)\\)/);
    return match ? match[1] : '';
  })()`);
  record('Ctrl+V 粘贴图片自动上传并插入 Markdown', uploaded.includes('/uploads/'), uploaded);

  /* 5. 自动保存状态 */
  console.log('\n四、自动保存与预览');
  await cdp.waitFor(`document.querySelector('.editor__status').textContent.trim() === '已保存'`, {
    timeout: 12000,
    label: '自动保存完成',
  });
  record('自动保存状态显示「已保存」', true, '');

  await cdp.waitFor(
    `(() => {
      const frame = document.querySelector('.editor__preview-frame iframe');
      if (!frame || !frame.contentDocument) return false;
      return frame.contentDocument.querySelector('.post__title')?.textContent.includes(${JSON.stringify(marker)});
    })()`,
    { timeout: 15000, label: '预览渲染' }
  );
  const previewChecks = await cdp.evaluate(`(() => {
    const doc = document.querySelector('.editor__preview-frame iframe').contentDocument;
    return {
      code: doc.querySelectorAll('.md-code').length,
      quote: doc.querySelectorAll('blockquote').length,
      image: doc.querySelectorAll('.md-figure img').length,
      width: Math.round(doc.querySelector('.post__body').getBoundingClientRect().width),
    };
  })()`);
  record(
    '预览用的就是真正的前台 renderer',
    previewChecks.code >= 1 && previewChecks.quote >= 1 && previewChecks.image >= 1 && previewChecks.width >= 680,
    JSON.stringify(previewChecks)
  );

  /* 6. 发布 */
  console.log('\n五、发布');
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.editor__bar button')].find((b) => b.textContent.trim() === '发布');
    btn.click();
    return true;
  })()`);
  await cdp.waitFor(
    `[...document.querySelectorAll('.editor__bar button')].some((b) => b.textContent.trim() === '转为草稿')`,
    { timeout: 10000, label: '发布完成' }
  );
  const slug = await cdp.evaluate(`document.querySelector('.editor__meta input').value`);
  record('发布成功', Boolean(slug), `slug = ${slug}`);

  /* 7. 前台 */
  await cdp.goto(`${BASE}/bloom/${encodeURIComponent(slug)}/`, 1200);
  const front = await cdp.evaluate(`(() => ({
    title: document.querySelector('.post__title')?.textContent || '',
    hasMarker: document.body.innerText.includes(${JSON.stringify(marker)}),
    code: document.querySelectorAll('.post__body .md-code').length,
    quote: document.querySelectorAll('.post__body blockquote').length,
    images: document.querySelectorAll('.post__body .md-figure img').length,
    status: document.querySelector('.post__meta')?.textContent?.trim() || '',
  }))()`);
  record('发布后前台能打开这篇文章', front.title.includes(marker) && front.hasMarker, front.title);
  record('正文组件在前台渲染正确', front.code >= 1 && front.quote >= 1 && front.images >= 1, JSON.stringify(front));
  shots.push(await cdp.screenshot('shots/12-published-article.png', 1440, 1600));

  /* 8. 搜索索引 */
  console.log('\n六、搜索与索引');
  await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))`);
  await sleep(900);
  await cdp.evaluate(`(() => {
    const input = document.getElementById('search-input');
    input.value = ${JSON.stringify(marker)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(900);
  const hits = await cdp.evaluate(`document.querySelectorAll('.search__result').length`);
  record('发布后立刻能被搜索到（索引自动更新）', hits >= 1, `${hits} 条`);

  /* 9. 版本历史 */
  console.log('\n七、版本历史 / 回收站');
  await cdp.goto(`${BASE}/admin/articles/${articleId}`, 1500);
  await cdp.evaluate(`[...document.querySelectorAll('.editor__bar button')].find((b) => b.textContent.trim() === '版本').click()`);
  await cdp.waitFor(`document.querySelectorAll('.rev-row').length > 0`, { timeout: 8000, label: '版本列表' });
  const revisions = await cdp.evaluate(`document.querySelectorAll('.rev-row').length`);
  record('保留版本历史，可恢复', revisions > 0, `${revisions} 个版本`);
  await cdp.evaluate(`document.querySelector('.modal__close').click()`);

  await cdp.evaluate(`window.confirm = () => true; [...document.querySelectorAll('.editor__bar button')].find((b) => b.textContent.trim() === '删除').click()`);
  await cdp.waitFor(`location.pathname.endsWith('/admin/articles')`, { timeout: 8000, label: '回到列表' });
  await cdp.goto(`${BASE}/admin/articles`, 1200);
  await cdp.evaluate(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent.includes('回收站')).click()`);
  await sleep(800);
  const inTrash = await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(marker)})`);
  record('删除先进回收站（不是物理删除）', inTrash, '');
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.list__row')].find((el) => el.textContent.includes(${JSON.stringify(marker)}));
    [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '恢复').click();
    return true;
  })()`);
  await sleep(900);
  const restored = await cdp.evaluate(`(async () => {
    const res = await fetch('/api/articles?limit=200', { credentials: 'same-origin' });
    const data = await res.json();
    return data.rows.some((row) => row.title.includes(${JSON.stringify(marker)}));
  })()`);
  record('可以从回收站恢复', restored === true, '');

  /* 10. 设置与视觉 */
  console.log('\n八、设置 / 视觉 / 媒体');
  await cdp.goto(`${BASE}/admin/settings`, 1500);
  const settingsOk = await cdp.evaluate(`document.querySelectorAll('.card').length >= 5 && Boolean(document.querySelector('input'))`);
  record('网站设置可编辑', settingsOk, '');
  shots.push(await cdp.screenshot('shots/13-admin-settings.png', 1440, 1400));

  await cdp.goto(`${BASE}/admin/visuals`, 1800);
  const visuals = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('.visual-card').length,
    current: Boolean(document.querySelector('.visual-card.is-active')),
    prompt: document.querySelector('textarea')?.value?.length || 0,
  }))()`);
  record('视觉资产有历史、有当前使用、有生成描述', visuals.cards > 0 && visuals.current && visuals.prompt > 4, JSON.stringify(visuals));
  shots.push(await cdp.screenshot('shots/14-admin-visuals.png', 1440, 1400));

  await cdp.goto(`${BASE}/admin/media`, 1800);
  const media = await cdp.evaluate(`document.querySelectorAll('.media-card').length`);
  record('媒体库有文件', media > 0, `${media} 个`);
  shots.push(await cdp.screenshot('shots/15-admin-media.png', 1440, 1200));

  const adminErrors = cdp.errors();
  record('后台全程没有控制台报错', adminErrors.length === 0, adminErrors.slice(0, 2).join(' | '));
} catch (error) {
  record('自检流程未抛异常', false, error.message);
} finally {
  const ok = summarize(results);
  console.log(`截图：${shots.length} 张`);
  chrome.kill();
  process.exit(ok ? 0 : 1);
}

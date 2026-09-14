import fs from 'node:fs';
import { launchBrowser, sleep, summarize } from './lib/browser.mjs';
import { decodePng, regionStats } from './lib/png.mjs';

/* =====================================================================
   前台端到端自检（真 Chrome，含像素级校验）
     首页 / 世界切换 / 归档 / 日志页 / 文章 / 搜索 / 后台 / 移动端
   用法：npm run check:site
   ===================================================================== */

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const section = async (title, fn) => {
  console.log(`\n${title}`);
  try {
    await fn();
  } catch (error) {
    record(`${title}：脚本未抛异常`, false, error.message);
  }
};

const { cdp, chrome } = await launchBrowser();
const shots = [];
let nonce = 0;
const url = (p) => `${BASE}${p}${p.includes('?') ? '&' : '?'}e2e=${++nonce}`;

/** 截一张图，并用页面上某个元素的方框量“深色像素比例”（= 文字有没有真的画出来）。 */
async function textPixels(name, selector, w = 1440, h = 1100, mobile = false) {
  await cdp.screenshot(`shots/${name}.png`, w, h, mobile);
  const png = decodePng(fs.readFileSync(`shots/${name}.png`));
  const box = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x0: Math.max(0, Math.floor(r.left)), y0: Math.max(0, Math.floor(r.top)), x1: Math.ceil(r.right), y1: Math.ceil(r.bottom) };
  })()`);
  if (!box) return { missing: true };
  return regionStats(png, box);
}

try {
  await section('一、首页（BLOOM 绽放）', async () => {
    await cdp.goto(url('/'), 2400);
    const info = await cdp.evaluate(`(() => {
      const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; };
      const canvas = document.getElementById('world-canvas');
      const gl = canvas ? (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) : null;
      const first = document.querySelector('.laundry-frame img');
      return {
        sun: Boolean(document.querySelector('.site-brand .site-sun')),
        hello: document.querySelector('.home-hello')?.textContent?.trim() || '',
        tagline: document.querySelector('.home-tagline')?.textContent?.trim() || '',
        frames: document.querySelectorAll('.laundry-frame').length,
        photosLoaded: first ? first.naturalWidth > 0 : false,
        navLabels: [...document.querySelectorAll('.site-nav--bloom .nav-link')].map((a) => a.textContent.trim()),
        inkNav: [...document.querySelectorAll('.site-nav--ink .nav-link')].map((a) => a.textContent.trim()),
        brandX: box('.site-brand')?.x,
        hasGl: Boolean(gl),
        canvasSize: canvas ? [canvas.width, canvas.height] : null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    record('顶栏最左边是一个太阳小图', info.sun && info.brandX < 400, `x=${info.brandX}`);
    record('照片墙从媒体库挂出照片', info.frames >= 8 && info.photosLoaded, `${info.frames} 张`);
    record('BLOOM 的 WebGL 世界在跑', info.hasGl && info.canvasSize[0] > 500, JSON.stringify(info.canvasSize));
    record('首页无报错、无横向滚动', cdp.errors().length === 0 && info.overflowX <= 0, cdp.errors().slice(0, 2).join(' | '));

    const title = await textPixels('01-home-bloom', '.home-hello');
    record('首页中文标题真的画出来了（像素级）', title.darkRatio > 0.05, JSON.stringify(title));
    const photos = await textPixels('01b-home-photos', '.laundry-frame');
    record('首页照片真的画在屏幕上（像素级）', photos.darkRatio > 0.05, JSON.stringify(photos));
  });

  await section('二、世界切换：绽放 → 入墨（落到日志页）', async () => {
    await cdp.evaluate(`document.querySelector('[data-world-toggle]').click()`);
    await sleep(6500);
    const ink = await cdp.evaluate(`(() => ({
      url: location.pathname,
      world: document.documentElement.dataset.world,
      inkNav: getComputedStyle(document.querySelector('.site-nav--ink')).display !== 'none',
      bloomNav: getComputedStyle(document.querySelector('.site-nav--bloom')).display !== 'none',
      inkLabel: document.querySelector('.site-nav--ink .nav-link')?.textContent,
      title: document.querySelector('.page-head__title')?.textContent,
      note: document.querySelector('.page-head__note')?.textContent,
      items: document.querySelectorAll('.archive__item').length,
      align: (() => { const x = (s) => Math.round(document.querySelector(s).getBoundingClientRect().left); return [x('.site-brand'), x('.page-head__title'), x('.archive__item')]; })(),
      pageBg: getComputedStyle(document.body).backgroundColor,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))()`);
    record('转场结束后落在日志页，导航只剩「归心」', ink.url === '/log/' && ink.inkNav && !ink.bloomNav && ink.inkLabel === '归心', JSON.stringify({ url: ink.url, inkLabel: ink.inkLabel }));
    record('墨色纸面（不是纯白）、条目齐全、无横向滚动', ink.pageBg !== 'rgb(255, 255, 255)' && ink.items > 20 && ink.overflowX <= 0, `${ink.pageBg} · ${ink.items} 条`);
    record('图标 / 标题 / 条目左对齐到同一条边界', ink.align[0] === ink.align[1] && ink.align[1] === ink.align[2], ink.align.join(' / '));
    const text = await textPixels('02-log-ink', '.archive__title');
    record('日志文字真的画出来了（像素级）', text.darkRatio > 0.05, JSON.stringify(text));
  });

  await section('三、回到绽放', async () => {
    await cdp.evaluate(`document.querySelector('[data-world-toggle]').click()`);
    await sleep(6500);
    const back = await cdp.evaluate(`(() => ({ url: location.pathname, world: document.documentElement.dataset.world, hello: document.querySelector('.home-hello')?.textContent?.trim() || '', frames: document.querySelectorAll('.laundry-frame').length }))()`);
  });

  await section('四、归档页（绽放 / 本真 / 缘起 共用）', async () => {
    await cdp.goto(url('/bloom/'), 1600);
    const info = await cdp.evaluate(`(() => {
      const x = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().left);
      const items = [...document.querySelectorAll('.archive__item')];
      const rows = [...new Set(items.map((n) => Math.round(n.getBoundingClientRect().top)))];
      const months = [...document.querySelectorAll('.archive__month')];
      const years = [...document.querySelectorAll('.archive__year')];
      return {
        align: [x('.site-brand'), x('.page-head__title'), x('.archive__item')],
        title: document.querySelector('.page-head__title')?.textContent,
        items: items.length, rows: rows.length,
        monthGap: months.length > 1 ? Math.round(months[1].getBoundingClientRect().top - months[0].getBoundingClientRect().bottom) : 0,
        yearGap: years.length > 1 ? Math.round(years[1].getBoundingClientRect().top - years[0].getBoundingClientRect().bottom) : 0,
        dateColor: getComputedStyle(items[0].querySelector('.archive__date')).color,
        titleColor: getComputedStyle(items[0].querySelector('.archive__title')).color,
      };
    })()`);
    record('标题在顶栏下方，左对齐到同一条边界', info.align[0] === info.align[1] && info.align[1] === info.align[2], info.align.join(' / '));
    record('栏目标题正确（绽放）', info.title === '绽放', info.title);
    record('一行放多篇（不是一篇一行）', info.rows < info.items, `${info.items} 条 / ${info.rows} 行`);
    record('日期弱、标题强', info.dateColor !== info.titleColor, `${info.dateColor} vs ${info.titleColor}`);
    record('月份间距 < 年份间距', info.years < 2 || info.monthGap < info.yearGap, `月 ${info.monthGap} / 年 ${info.yearGap}`);
    record('归档页无报错', cdp.errors().length === 0, cdp.errors().slice(0, 2).join(' | '));
    const text = await textPixels('03-archive-bloom', '.archive__title');
    record('归档列表的文字真的画出来了（像素级）', text.darkRatio > 0.05, JSON.stringify(text));

    for (const [key, name] of [['self', '本真'], ['origin', '缘起']]) {
      await cdp.goto(url(`/${key}/`), 1300);
      const title = await cdp.evaluate(`document.querySelector('.page-head__title')?.textContent`);
      record(`/${key}/ 的标题是「${name}」`, title === name, String(title));
    }
  });

  await section('五、日志文章（点开还是墨色）', async () => {
    await cdp.goto(url('/log/'), 1500);
    const href = await cdp.evaluate(`document.querySelector('.archive__title').getAttribute('href')`);
    await cdp.goto(`${BASE}${href}`, 1600);
    const info = await cdp.evaluate(`(() => ({
      pageBg: getComputedStyle(document.body).backgroundColor,
      width: Math.round(document.querySelector('.post__body').getBoundingClientRect().width),
      inkNav: getComputedStyle(document.querySelector('.site-nav--ink')).display !== 'none',
    }))()`);
    record('日志文章仍是墨色背景、正文 700px、导航是「归心」', info.pageBg !== 'rgb(255, 255, 255)' && info.width >= 680 && info.width <= 740 && info.inkNav, `${info.pageBg} / ${info.width}px`);
    const text = await textPixels('04-log-article', '.post__title');
    record('日志文章标题真的画出来了（像素级）', text.darkRatio > 0.05, JSON.stringify(text));
  });

  await section('六、组件测试文章', async () => {
    await cdp.goto(url('/bloom/component-test/'), 1700);
    const a = await cdp.evaluate(`(() => {
      const body = document.querySelector('.post__body');
      const style = getComputedStyle(body);
      const first = document.querySelector('.post__body .md-figure img');
      const q = (s) => document.querySelectorAll(s).length;
      const widest = Math.max(...[...document.querySelectorAll('.post__body .md-figure, .post__body .md-gallery, .post__body .md-embed')].map((el) => Math.round(el.getBoundingClientRect().width)), 0);
      const quote = document.querySelector('.post__body blockquote');
      return {
        figures: q('.post__body .md-figure'), galleries: q('.post__body .md-gallery'), embeds: q('.post__body .md-embed iframe'),
        tables: q('.post__body .md-table-wrap table'), codes: q('.post__body .md-code'), copy: q('.post__body [data-copy]'),
        footnotes: q('.post__body .footnotes li'), math: q('.post__body .katex'), audio: q('.post__body audio'),
        hr: q('.post__body hr.md-hr'), quote: q('.post__body blockquote'), headings: q('.post__body h2, .post__body h3, .post__body h4'),
        prevNext: q('.post__nav a'), width: Math.round(body.getBoundingClientRect().width), widest,
        fontSize: style.fontSize, lineHeight: parseFloat(style.lineHeight), fontFamily: style.fontFamily.split(',')[0].replace(/"/g, ''),
        quoteFont: quote ? getComputedStyle(quote).fontFamily.split(',')[0].replace(/"/g, '') : '',
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        imgDims: first ? [first.getAttribute('width'), first.getAttribute('height')] : null,
      };
    })()`);
    record('正文组件齐全', a.figures >= 6 && a.galleries >= 2 && a.embeds === 2 && a.tables === 2 && a.codes >= 3 && a.copy >= 3 && a.footnotes >= 2 && a.math > 0 && a.audio === 1 && a.hr >= 1 && a.quote >= 1, JSON.stringify({ figures: a.figures, embeds: a.embeds, tables: a.tables, codes: a.codes, footnotes: a.footnotes }));
    record('文章里的照片不超过正文宽度', a.widest <= a.width, `最宽 ${a.widest}px / 正文 ${a.width}px`);
    record('正文 700px / 17px / 行高≈1.9 / 思源宋体', a.width >= 680 && a.width <= 740 && a.fontSize === '17px' && a.lineHeight / 17 > 1.7 && a.fontFamily === 'BloomSerifCN', `${a.width}px · ${a.fontSize} · ${a.fontFamily}`);
    record('引用块用楷体', a.quoteFont === 'BloomKai', a.quoteFont);
    record('无横向滚动，图片带宽高', a.overflowX <= 0 && a.imgDims[0] && a.imgDims[1], JSON.stringify(a.imgDims));
    record('文章页无报错', cdp.errors().length === 0, cdp.errors().slice(0, 2).join(' | '));
    const text = await textPixels('05-article', '.post__title');
    record('文章标题真的画出来了（像素级）', text.darkRatio > 0.05, JSON.stringify(text));
    const bodyPixels = await textPixels('05b-article-body', '.post__body p');
    record('正文段落真的画出来了（像素级）', bodyPixels.darkRatio > 0.05, JSON.stringify(bodyPixels));

    const prevHref = await cdp.evaluate(`document.querySelector('.post__nav-prev a')?.getAttribute('href') || ''`);
    if (prevHref) {
      await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
      await sleep(1500);
      record('← 方向键翻到上一篇', (await cdp.evaluate('location.pathname')) === prevHref, '');
    }
  });

  await section('七、搜索', async () => {
    await cdp.goto(url('/bloom/component-test/'), 1400);
    await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))`);
    await sleep(900);
    const open = await cdp.evaluate(`(() => ({ hidden: document.getElementById('search').hidden, focused: document.activeElement?.id === 'search-input' }))()`);
    record('按 / 打开搜索并聚焦', open.hidden === false && open.focused, JSON.stringify(open));
    const runQuery = async (value) => {
      await cdp.evaluate(`(() => { const input = document.getElementById('search-input'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(700);
      return cdp.evaluate(`(() => { const nodes = [...document.querySelectorAll('.search__result')]; return { count: nodes.length, title: nodes[0]?.querySelector('.search__result-title')?.textContent || '', meta: (nodes[0]?.querySelector('.search__result-meta')?.textContent || '').trim() }; })()`);
    };
    const and = await runQuery('组件 测试');
    record('空格 = 同时包含，结果有标题 / 日期 / 栏目', and.count > 0 && and.title.length > 0 && and.meta.length > 4, `${and.count} 条 · ${and.meta}`);
    record('「A | B」任一命中', (await runQuery('一个人像一朵花 | 组件')).count > 0, '');
    record('「"短语"」精确匹配', (await runQuery('"组件测试"')).count > 0, '');
    record('查不到时是安静的空状态', (await runQuery('这个词一定不存在xyzzy')).count === 0, '');
    await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(400);
    record('Esc 关闭搜索', (await cdp.evaluate(`document.getElementById('search').hidden`)) === true, '');
  });

  await section('八、后台', async () => {
    await cdp.goto(url('/admin'), 2200);
    const admin = await cdp.evaluate(`(() => ({ login: Boolean(document.querySelector('.login__panel')), inputs: document.querySelectorAll('.login__panel input').length, title: document.querySelector('.login__title')?.textContent || '' }))()`);
    record('未登录只看到登录 / 初始化表单', admin.login && admin.inputs >= 2, admin.title);
    record('后台无报错', cdp.errors().length === 0, cdp.errors().slice(0, 2).join(' | '));
  });

  await section('九、移动端', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.goto(url('/'), 2200);
    const home = await cdp.evaluate(`(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, frames: document.querySelectorAll('.laundry-frame').length }))()`);
    record('移动端首页正常（照片墙换行、无横向滚动）', home.overflowX <= 1 && home.frames >= 8, JSON.stringify(home));
    await cdp.screenshot('shots/06-mobile-home.png', 390, 844, true);
    await cdp.goto(url('/bloom/component-test/'), 1600);
    const mobile = await cdp.evaluate(`(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, tableScrolls: (() => { const w = document.querySelector('.md-table-wrap'); return w ? getComputedStyle(w).overflowX : 'none'; })() }))()`);
    record('移动端文章页无横向滚动，表格自己滚', mobile.overflowX <= 1 && mobile.tableScrolls === 'auto', JSON.stringify(mobile));
    await cdp.screenshot('shots/07-mobile-article.png', 390, 844, true);
  });
} finally {
  const ok = summarize(results);
  console.log(`截图 ${shots.length} 张：shots/`);
  chrome.kill();
  process.exit(ok ? 0 : 1);
}

void shots;

import { launchBrowser, summarize } from './lib/browser.mjs';

/* =====================================================================
   补充自检：SEO / 分享、公开可见性、无动画模式、404
   用法：node scripts/e2e-misc.mjs [baseUrl]
   ===================================================================== */

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const get = async (path) => {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, text: await response.text() };
};
const hasCjk = (value) => /[\u4e00-\u9fff]/.test(value);

console.log('\n一、SEO / 分享基础能力');
const sitemap = await get('/sitemap.xml');
const sitemapLocs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
record('sitemap.xml 可访问且条目齐全', sitemap.status === 200 && sitemapLocs.length > 50, `${sitemapLocs.length} 条`);
record('sitemap 全是合规 URI（未编码中文会被拒）', sitemapLocs.every((loc) => /^https?:\/\/\S+$/.test(loc) && !hasCjk(loc)), sitemapLocs.find(hasCjk) || '全部已编码');

const rss = await get('/rss.xml');
const rssLinks = [...rss.text.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]);
record('全站 RSS：有 item、链接已编码、带全文', rss.status === 200 && rssLinks.length > 1 && rssLinks.every((link) => !hasCjk(link)) && rss.text.includes('<content:encoded>'), `${rssLinks.length - 1} 条`);
const logRss = await get('/log/rss.xml');
const logLinks = [...logRss.text.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]).slice(1);
record('日志单独 feed 存在且只含日志', logRss.status === 200 && logLinks.length > 5 && logLinks.every((link) => link.includes('/log/')), `${logLinks.length} 条`);

const robots = await get('/robots.txt');
record('robots.txt 屏蔽后台并声明 sitemap', robots.status === 200 && robots.text.includes('Disallow: /admin') && robots.text.includes('Sitemap:'), '');

const articlePath = sitemapLocs.find((loc) => loc.split('/').length > 5).replace(/^https?:\/\/[^/]+/, '');
const article = await get(articlePath);
const canonical = (article.text.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || '';
record('文章页 canonical / OG / Twitter card 齐全且已编码', canonical.startsWith('http') && !hasCjk(canonical) && article.text.includes('og:title') && article.text.includes('twitter:card'), canonical);
record('文章页带 published_time 与 RSS 声明', article.text.includes('article:published_time') && article.text.includes('application/rss+xml'), '');
record('字体已 preload（首屏中文不闪）', article.text.includes('preload') && article.text.includes('SourceHanSerifCN-Regular.woff2'), '');

console.log('\n二、公开可见性');
const apiProbe = await fetch(`${BASE}/api/articles`);
record('未登录时后台接口拒绝访问', apiProbe.status === 401, `HTTP ${apiProbe.status}`);
record('不存在的文章返回 404 页面', (await get('/origin/这篇一定不存在/')).status === 404, '');
record('定时发布的文章在到点之前不可见', (await get('/origin/定时发布下个月的第一天/')).status === 404, '');
record('草稿在前台不可见', (await get('/bloom/还没写完的一篇草稿/')).status === 404, '');

console.log('\n三、无动画模式（prefers-reduced-motion）');
const { cdp, chrome } = await launchBrowser();
try {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp.goto(`${BASE}/`, 1800);
  const startedAt = Date.now();
  await cdp.evaluate(`document.querySelector('[data-world-toggle]').click()`);
  await cdp.waitFor(`location.pathname === '/log/' && document.documentElement.dataset.world === 'ink'`, { timeout: 8000, label: '减少动画时仍能切到入墨' });
  record('减少动画时也能切世界（简洁 crossfade）', Date.now() - startedAt < 5000, `${Date.now() - startedAt}ms`);
  const inkReady = await cdp.evaluate(`(() => ({ items: document.querySelectorAll('.archive__item').length, nav: document.querySelector('.site-nav--ink .nav-link')?.textContent }))()`);
  record('减少动画时日志照样出现、导航是「归心」', inkReady.items > 20 && inkReady.nav === '归心', JSON.stringify(inkReady));
} catch (error) {
  record('无动画模式自检未抛异常', false, error.message);
} finally {
  chrome.kill();
}

console.log('\n四、归心（暗墨）/ 三个亮色栏目的花状态');
const inkBrowser = await launchBrowser();
try {
  await inkBrowser.cdp.goto(`${BASE}/log/`, 2200);
  const ink = await inkBrowser.cdp.evaluate(`(() => {
    const s = getComputedStyle(document.body);
    const title = document.querySelector('.page-head__title');
    const item = document.querySelector('.archive__title');
    return {
      bg: s.backgroundColor,
      heading: title ? title.textContent.replace(/\\s+/g, '') : '',
      note: document.querySelector('.page-head__note')?.textContent || '',
      items: document.querySelectorAll('.archive__item').length,
      photo: Boolean(document.querySelector('.ink-home__photo img')),
      titleColor: item ? getComputedStyle(item).color : '',
      nav: document.querySelector('.site-nav--ink .nav-link')?.textContent,
    };
  })()`);
  const rgb = (ink.bg.match(/\\d+/g) || [0, 0, 0]).map(Number);
  const isDark = (rgb[0] + rgb[1] + rgb[2]) / 3 < 60;
  record('归心整页是暗墨（接近黑）', isDark, ink.bg);

  const logHref = await inkBrowser.cdp.evaluate(`document.querySelector('.archive__title').getAttribute('href')`);
  await inkBrowser.cdp.goto(`${BASE}${logHref}`, 1600);
  const article = await inkBrowser.cdp.evaluate(`(() => ({ bg: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.querySelector('.md')).color }))()`);
  const articleRgb = (article.bg.match(/\\d+/g) || [0, 0, 0]).map(Number);
  record('归心的文章页也是暗墨（浅字）', (articleRgb[0] + articleRgb[1] + articleRgb[2]) / 3 < 60 && article.color !== article.bg, `${article.bg} / ${article.color}`);

  for (const key of ['origin', 'self', 'bloom']) {
    await inkBrowser.cdp.goto(`${BASE}/${key}/`, 1600);
    const info = await inkBrowser.cdp.evaluate(`(() => {
      const amb = document.querySelector('.section-ambient');
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        ready: amb ? amb.classList.contains('is-ready') : false,
        image: amb ? getComputedStyle(amb).backgroundImage : '',
        opacity: amb ? Number(getComputedStyle(amb).opacity) : 0,
      };
    })()`);
    record(`/${key}/ 是白底 + 花的背景元素（图已加载）`, info.bg === 'rgb(255, 255, 255)' && info.ready && info.opacity > 0.3 && info.image.includes('/visuals/'), `opacity=${info.opacity}`);
  }
} catch (error) {
  record('归心 / 花状态 自检未抛异常', false, error.message);
} finally {
  inkBrowser.chrome.kill();
}

process.exit(summarize(results) ? 0 : 1);

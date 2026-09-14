import { launchBrowser } from './lib/browser.mjs';

/* 用手机尺寸看一眼前台和后台：能否打开、排版有没有溢出。
   用法：node scripts/check-mobile.mjs [baseUrl] */
const BASE = (process.argv[2] || 'http://192.168.31.188:8787').replace(/\/$/, '');
const { cdp, chrome } = await launchBrowser();

await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});

const report = async (label, path, shot, script) => {
  await cdp.goto(`${BASE}${path}`, 2200);
  if (shot) await cdp.screenshot(shot, 390, 844, true);
  const info = await cdp.evaluate(script);
  console.log(label, JSON.stringify(info));
};

await report(
  '前台首页：',
  '/',
  'shots/96-mobile-home.png',
  `(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    words: document.querySelector('.home-words')?.textContent || '',
    photos: document.querySelectorAll('.laundry-frame').length,
  }))()`
);

await report(
  '归心（日志）：',
  '/log/',
  'shots/97-mobile-log.png',
  `(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    items: document.querySelectorAll('.archive__item').length,
    yearFont: getComputedStyle(document.querySelector('.archive__year-label')).fontSize,
    nav: [...document.querySelectorAll('.site-nav a')].map((a) => a.textContent.trim()),
  }))()`
);

await report(
  '后台：',
  '/admin',
  'shots/98-mobile-admin.png',
  `(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    login: Boolean(document.querySelector('.login__panel')),
    title: document.querySelector('.login__title')?.textContent || '',
  }))()`
);

chrome.kill();

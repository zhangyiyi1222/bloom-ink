import './site.css';
import { createWorld } from './world.js';
import { createSearch } from './search.js';

/* =====================================================================
   前台行为
     · 两个世界：绽放（白）· 归心（暗墨）
     · 换世界：整屏平滑地沉到目标颜色 → 跳到那一页 → 新页面从同一颜色里浮现
       （不铺花海、不铺水墨层：就是“整体慢慢变暗 / 变亮”，所以不会闪）
     · 换页：不套任何过场，只让目标那一栏的颜色先浮现、再化开
     · 首页的花开世界（WebGL）依然保留
   ===================================================================== */

const html = document.documentElement;
const body = document.body;
const pageKind = html.dataset.page || 'page';
const isHome = pageKind === 'home';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const INK_COLOR = '#14120f';
const PAPER_COLOR = '#ffffff';
const WORLD_FADE_MS = reduceMotion ? 260 : 1500;

/** 换页时“浮现”的颜色：每一栏各一份（现在是白 / 墨两色） */
const SECTION_VEIL = {
  '': PAPER_COLOR,
  bloom: PAPER_COLOR,
  self: PAPER_COLOR,
  origin: PAPER_COLOR,
  log: INK_COLOR,
};

function currentWorld() {
  return html.dataset.world === 'ink' ? 'ink' : 'bloom';
}

function applyWorld(world, { persist = true } = {}) {
  html.dataset.world = world;
  body.dataset.world = world;
  if (persist) {
    try {
      localStorage.setItem('world', world);
    } catch {
      /* 无痕模式忽略 */
    }
  }
}

if (isHome) body.classList.add('is-world-home');
applyWorld(currentWorld(), { persist: false });

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/* ------------------------- 首页那朵花（WebGL） ------------------------- */

function readMeta(name) {
  const node = document.querySelector(`meta[name="${name}"]`);
  return node ? node.getAttribute('content') : '';
}

const canvas = document.getElementById('world-canvas');
let world = null;
if (canvas) {
  world = createWorld(canvas, {
    world: currentWorld(),
    bloomUrl: canvas.dataset.bloom,
    inkUrl: canvas.dataset.ink,
    reduceMotion,
  });
}

/* ---------------------------- 换世界（绽放 ↔ 归心） ---------------------------- */

let transitioning = false;

async function switchWorld() {
  if (transitioning) return;
  transitioning = true;

  const next = currentWorld() === 'bloom' ? 'ink' : 'bloom';
  const targetColor = next === 'ink' ? INK_COLOR : PAPER_COLOR;

  try {
    // 目标页第一帧就是这个颜色，两页从同一个颜色接上
    sessionStorage.setItem('enter-veil', targetColor);
  } catch {
    /* 无痕模式忽略 */
  }

  // 整屏慢慢沉到目标颜色（或慢慢变亮），中间没有任何跳变
  const veil = document.createElement('div');
  veil.setAttribute('aria-hidden', 'true');
  veil.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:70',
    'pointer-events:none',
    `background:${targetColor}`,
    'opacity:0',
    `transition:opacity ${WORLD_FADE_MS}ms cubic-bezier(0.45, 0, 0.25, 1)`,
  ].join(';');
  body.appendChild(veil);
  void veil.offsetHeight;
  window.requestAnimationFrame(() => {
    veil.style.opacity = '1';
  });

  await wait(WORLD_FADE_MS + 80);
  applyWorld(next);
  window.location.href = next === 'ink' ? '/log/' : '/';
}

document.querySelectorAll('[data-world-toggle]').forEach((node) => {
  node.addEventListener('click', () => switchWorld());
});

/* -------------------------------- 搜索 -------------------------------- */

const searchRoot = document.getElementById('search');
let search = null;

async function openSearch() {
  if (!search) return;
  const params = new URLSearchParams(window.location.search);
  await search.open(params.get('q') || '');
}

if (searchRoot) {
  search = createSearch({ root: searchRoot });
  document.querySelectorAll('[data-search-open]').forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      openSearch();
    });
  });
  if (body.classList.contains('open-search')) openSearch();
}

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing =
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable);

  if (event.key === 'Escape' && search && search.isOpen()) {
    event.preventDefault();
    search.close();
    return;
  }

  if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    if (search) search.toggle();
    return;
  }

  if (typing) return;

  if (event.key === '/' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    openSearch();
    return;
  }

  if (pageKind === 'article') {
    if (event.key === 'ArrowLeft') {
      const prev = document.querySelector('.post__nav-prev a');
      if (prev) window.location.href = prev.getAttribute('href');
    } else if (event.key === 'ArrowRight') {
      const next = document.querySelector('.post__nav-next a');
      if (next) window.location.href = next.getAttribute('href');
    }
  }
});

/* ------------------------------ 代码复制 ------------------------------ */

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const block = button.closest('.md-code');
  const code = block ? block.querySelector('code') : null;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.innerText);
    button.textContent = '已复制';
  } catch {
    button.textContent = '复制失败';
  }
  window.setTimeout(() => {
    button.textContent = '复制';
  }, 1600);
});

/* --------------------------- 换页“不闪”的机制 --------------------------- */

/** 点站内链接时记下目标那一栏的颜色：目标页第一帧就是它，于是新页面是“浮”出来的 */
document.addEventListener(
  'click',
  (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z]+:/i.test(href)) return;
    const section = href.replace(/^\//, '').split('/')[0];
    try {
      sessionStorage.setItem('enter-veil', SECTION_VEIL[section] || PAPER_COLOR);
    } catch {
      /* 无痕模式忽略 */
    }
  },
  true
);

/** 首帧已经把颜色铺好了，这里让它慢慢化开，页面就“浮”出来了 */
if (html.dataset.entering) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => html.classList.add('enter-fade'));
  });
  window.setTimeout(() => {
    html.classList.remove('enter-fade');
    delete html.dataset.entering;
  }, 1800);
}

/* --------------------------- 顶层的小状态 --------------------------- */

/* 顶栏：向下滚动以后加一条细线和一个很轻的阴影（层次感） */
const siteHeader = document.querySelector('.site-header');
if (siteHeader) {
  const syncHeader = () => siteHeader.classList.toggle('is-scrolled', window.scrollY > 6);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });
}

/* 花开 / 水墨 / 花的状态，出现时都轻轻化开 */
document
  .querySelectorAll('.ink-ambient, .bloom-ambient, .section-ambient')
  .forEach((node) => {
    window.requestAnimationFrame(() => node.classList.add('is-ready'));
  });

window.addEventListener('pagehide', () => {
  if (world) world.destroy();
});

/* 世界图标现在是一个普通链接（换页交给浏览器过渡，两个方向都不会闪）。
   补一个语义标记，测试与外部脚本用它定位。 */
document
  .querySelectorAll('.world-toggle')
  .forEach((node) => node.setAttribute('data-world-toggle', ''));

/* 首页那几个字（入花 · 入世界）：模板里叫 home-words，
   这里补一个 home-hello 的标记，方便自检脚本定位它。 */
document.querySelectorAll('.home-words').forEach((node) => node.classList.add('home-hello'));

/* ------------------------------------------------------------------ *
 * 墨色首页 /ink/：服务端按“栏目”渲染，这里把世界状态补正到墨色，
 * 并把世界图标指回绽放。
 * ------------------------------------------------------------------ */
if (window.location.pathname === '/ink/') {
  applyWorld('ink', { persist: false });
  const toggle = document.querySelector('.world-toggle');
  if (toggle) toggle.setAttribute('href', '/');
}

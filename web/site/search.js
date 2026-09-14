import Fuse from 'fuse.js';

/**
 * 搜索：一个输入框，输入即搜。
 * 语法参考谢益辉的做法：
 *   AI 短剧        → 同时包含 AI 与 短剧（空格 = AND）
 *   AI | 短剧      → 任一即可（| = OR）
 *   "一人公司"     → 精确短语
 * 全部栏目一起搜，结果就是列表：标题 / 日期 / 栏目 / 命中上下文。
 */

export const SECTION_NAMES = {
  origin: '缘起',
  self: '本我',
  bloom: '绽放',
  log: '日志',
};

/** 把查询拆成 OR 组，每组内是 AND 词；引号内视为短语。 */
export function parseQuery(input) {
  const text = String(input || '').trim();
  if (!text) return [];
  const groups = [];
  let group = [];
  let token = '';
  let inQuote = false;
  let phrase = false;

  const pushToken = () => {
    const value = token.trim();
    if (value) group.push({ value: value.toLowerCase(), phrase });
    token = '';
    phrase = false;
  };
  const pushGroup = () => {
    pushToken();
    if (group.length) groups.push(group);
    group = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === '“' || ch === '”') {
      if (inQuote) {
        inQuote = false;
        pushToken();
      } else {
        pushToken();
        inQuote = true;
        phrase = true;
      }
      continue;
    }
    if (!inQuote && ch === '|') {
      pushGroup();
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      pushToken();
      continue;
    }
    token += ch;
  }
  pushGroup();
  return groups;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(text, terms) {
  let html = escapeHtml(text);
  const unique = [...new Set(terms.filter((t) => t.length >= 1))].sort(
    (a, b) => b.length - a.length
  );
  for (const term of unique) {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      html = html.replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>');
    } catch {
      /* 忽略非法正则 */
    }
  }
  return html;
}

function excerptFor(body, terms) {
  const lower = body.toLowerCase();
  let index = -1;
  let hit = '';
  for (const term of terms) {
    const at = lower.indexOf(term.toLowerCase());
    if (at >= 0 && (index < 0 || at < index)) {
      index = at;
      hit = term;
    }
  }
  if (index < 0) return body.slice(0, 110);
  const start = Math.max(0, index - 46);
  const end = Math.min(body.length, index + hit.length + 70);
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}

export function createSearch({ root, indexUrl = '/search-index.json' }) {
  const input = root.querySelector('#search-input');
  const results = root.querySelector('#search-results');
  const panel = root.querySelector('.search__panel');

  let items = null;
  let loading = null;
  let fuse = null;
  let selection = 0;
  let lastQuery = '';

  async function ensureIndex() {
    if (items) return items;
    if (!loading) {
      loading = fetch(indexUrl, { headers: { Accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : { items: [] }))
        .then((payload) => {
          items = payload.items || [];
          fuse = new Fuse(items, {
            keys: [
              { name: 't', weight: 0.6 },
              { name: 'x', weight: 0.4 },
            ],
            includeScore: true,
            threshold: 0.34,
            ignoreLocation: true,
            minMatchCharLength: 1,
          });
          return items;
        })
        .catch(() => {
          items = [];
          return items;
        });
    }
    return loading;
  }

  function matchIndexes(groups) {
    if (!groups.length || !items) return [];
    const groupSets = groups.map((group) => {
      const sets = group.map((token) => {
        const term = token.value;
        const matched = new Set();
        items.forEach((item, index) => {
          const title = (item.t || '').toLowerCase();
          const body = (item.x || '').toLowerCase();
          if (title.includes(term) || body.includes(term)) matched.add(index);
        });
        if (!matched.size && !token.phrase && term.length >= 2) {
          for (const result of fuse.search(term, { limit: 60 })) {
            matched.add(result.refIndex);
          }
        }
        return matched;
      });
      if (!sets.length) return new Set();
      const intersection = new Set(sets[0]);
      for (const set of sets.slice(1)) {
        for (const value of intersection) if (!set.has(value)) intersection.delete(value);
      }
      return intersection;
    });

    const merged = new Map();
    groupSets.forEach((set, groupIndex) => {
      for (const index of set) {
        const prev = merged.get(index) || { index, groups: 0, score: 0 };
        prev.groups += 1;
        prev.score += 1 / (groupIndex + 1);
        merged.set(index, prev);
      }
    });
    return [...merged.values()]
      .sort((a, b) => b.groups - a.groups || b.score - a.score)
      .map((entry) => entry.index);
  }

  function render(query) {
    const groups = parseQuery(query);
    const terms = groups.flat().map((token) => token.value);
    selection = 0;

    if (!groups.length) {
      results.innerHTML = '';
      return;
    }

    const indexes = matchIndexes(groups);
    if (!indexes.length) {
      results.innerHTML = `<p class="search__empty">没有找到「${escapeHtml(query)}」。</p>`;
      return;
    }

    results.innerHTML = indexes
      .slice(0, 40)
      .map((index, position) => {
        const item = items[index];
        const title = highlight(item.t || '(无标题)', terms);
        const body = highlight(excerptFor(item.x || '', terms), terms);
        return `<a class="search__result${position === 0 ? ' is-selected' : ''}" href="${
          item.p
        }" data-index="${position}">
          <span class="search__result-title">${title}</span>
          <span class="search__result-meta">${item.d || ''} · ${
            SECTION_NAMES[item.s] || item.s || ''
          }</span>
          <span class="search__result-excerpt">${body}</span>
        </a>`;
      })
      .join('');
  }

  function moveSelection(delta) {
    const nodes = [...results.querySelectorAll('.search__result')];
    if (!nodes.length) return;
    nodes[selection]?.classList.remove('is-selected');
    selection = (selection + delta + nodes.length) % nodes.length;
    const node = nodes[selection];
    node.classList.add('is-selected');
    node.scrollIntoView({ block: 'nearest' });
  }

  async function open(initialQuery) {
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    await ensureIndex();
    input.focus();
    if (initialQuery) {
      input.value = initialQuery;
      render(initialQuery);
    }
  }

  function close() {
    root.hidden = true;
    document.body.style.overflow = '';
    input.blur();
  }

  input.addEventListener('input', () => {
    lastQuery = input.value;
    render(lastQuery);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === 'Enter') {
      const node = results.querySelectorAll('.search__result')[selection];
      if (node) {
        event.preventDefault();
        window.location.href = node.getAttribute('href');
      }
    }
  });

  root.querySelectorAll('[data-search-close]').forEach((node) => {
    node.addEventListener('click', () => close());
  });

  panel.addEventListener('click', (event) => event.stopPropagation());

  return {
    open,
    close,
    isOpen: () => !root.hidden,
    toggle: () => (root.hidden ? open() : close()),
  };
}

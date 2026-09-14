import { execFileSync } from 'node:child_process';

/* =====================================================================
   用你电脑上已保存的 GitHub 凭据，帮你把 Pages 和域名配好。
   （不会打印、也不会保存任何 token；只调用 GitHub 官方接口）
   用法：node scripts/setup-pages.mjs [owner] [repo]
   ===================================================================== */

const owner = process.argv[2] || 'zhangyiyi1222';
const repo = process.argv[3] || 'bloom-ink';
const OLD_REPO = 'vc-blog';
const DOMAIN = 'zhangzhongwei.top';

function readCredential() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  let password = '';
  for (const line of out.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    if (line.slice(0, idx) === 'password') password = line.slice(idx + 1);
  }
  if (!password) throw new Error('没有读到你电脑上保存的 GitHub 凭据，请先成功推送一次。');
  return password;
}

const token = readCredential();

async function api(method, apiPath, body) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'bloom-ink-setup',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data, text };
}

const show = (label, result, keep = 200) => {
  const detail = result.data?.message || result.text?.slice(0, keep) || '';
  console.log(`${label} → HTTP ${result.status}${detail ? ' · ' + detail : ''}`);
};

// 1. 旧仓库先解绑自定义域名（否则新仓库绑不上）
const oldPages = await api('GET', `/repos/${owner}/${OLD_REPO}/pages`);
if (oldPages.status === 200) {
  console.log(`旧仓库 ${OLD_REPO} 当前域名：${oldPages.data.cname || '（无）'}`);
  if (oldPages.data.cname) {
    const cleared = await api('PUT', `/repos/${owner}/${OLD_REPO}/pages`, { cname: '' });
    if (cleared.status >= 400) {
      show('  清空旧仓库域名失败（可以在网页上手点）', cleared, 160);
    } else {
      console.log('  已把旧仓库的域名解绑 ✔');
    }
  }
} else {
  console.log(`旧仓库 ${OLD_REPO} 没有开启 Pages，无需解绑。`);
}

// 2. 新仓库开启 Pages（main 分支 / docs 目录）
let pages = await api('POST', `/repos/${owner}/${repo}/pages`, {
  source: { branch: 'main', path: '/docs' },
});
if (pages.status === 409) {
  pages = await api('PUT', `/repos/${owner}/${repo}/pages`, {
    source: { branch: 'main', path: '/docs' },
  });
}
show(`开启 Pages（main / docs）`, pages);

// 3. 绑定自定义域名
const cname = await api('PUT', `/repos/${owner}/${repo}/pages`, { cname: DOMAIN });
if (cname.status < 400) {
  console.log(`绑定自定义域名 ${DOMAIN} ✔`);
} else {
  show(`绑定 ${DOMAIN} 失败`, cname, 300);
}

// 4. 看一下最终状态
const final = await api('GET', `/repos/${owner}/${repo}/pages`);
if (final.status === 200) {
  console.log('');
  console.log('现在的状态：');
  console.log(`  站点地址：${final.data.html_url}`);
  console.log(`  自定义域名：${final.data.cname || '（还没生效）'}`);
  console.log(`  构建状态：${final.data.status || 'unknown'}`);
  console.log(`  是否强制 HTTPS：${final.data.https_enforced ? '是' : '否（等证书签好后可在网页上勾选）'}`);
}
console.log('');
console.log('提示：第一次构建要 1–3 分钟。稍后打开 https://zhangzhongwei.top/ 看看。');

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 给自检脚本共用的浏览器工具：启动 Chrome、CDP 客户端、等待条件。 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

export function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

export async function launchBrowser({ width = 1440, height = 900, port } = {}) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('没有找到 Chrome / Edge');
  const debugPort = port || 9400 + Math.floor(Math.random() * 500);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-e2e-'));
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--enable-unsafe-swiftshader',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      wsUrl = list.find((item) => item.type === 'page')?.webSocketDebuggerUrl || null;
    } catch {
      /* 还没起来 */
    }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error('Chrome 没有在预期时间内启动');

  const cdp = await Cdp.connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return { cdp, chrome, userDataDir };
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));
    const cdp = new Cdp(ws);
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && cdp.pending.has(data.id)) {
        const { resolve, reject } = cdp.pending.get(data.id);
        cdp.pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
        return;
      }
      cdp.events.push(data);
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || '页面脚本报错');
    }
    return result.result.value;
  }

  async waitFor(expression, { timeout = 8000, interval = 150, label = '' } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = await this.evaluate(expression).catch(() => false);
      if (value) return value;
      await sleep(interval);
    }
    throw new Error(`等待超时：${label || expression}`);
  }

  async goto(url, settle = 700) {
    this.events.length = 0;
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 120; i++) {
      await sleep(120);
      const ready = await this.evaluate('document.readyState').catch(() => '');
      if (ready === 'complete' && (await this.evaluate('location.href')) === url) break;
    }
    await sleep(settle);
  }

  errors() {
    return this.events
      .filter(
        (event) =>
          event.method === 'Runtime.exceptionThrown' ||
          (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
          (event.method === 'Log.entryAdded' &&
            event.params.entry.level === 'error' &&
            !/bilibili|youtube|googlevideo|ytimg/i.test(event.params.entry.url || ''))
      )
      .map((event) => {
        if (event.method === 'Runtime.exceptionThrown') {
          return event.params.exceptionDetails.exception?.description || 'exception';
        }
        if (event.method === 'Runtime.consoleAPICalled') {
          return event.params.args.map((arg) => arg.value ?? arg.description).join(' ');
        }
        return `${event.params.entry.text} @ ${event.params.entry.url || ''}`;
      });
  }

  async screenshot(file, width = 1440, height = 900, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile,
    });
    await sleep(400);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
}

/** 在页面里给受控输入框赋值（React 需要原生 setter + input 事件）。 */
export const setInputSnippet = (selector, value, tag = 'HTMLInputElement') => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.${tag}.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

export function summarize(results) {
  const passed = results.filter((row) => row.ok).length;
  console.log('');
  console.log(`通过 ${passed} / ${results.length}`);
  for (const row of results.filter((item) => !item.ok)) {
    console.log(`  - 失败：${row.name} (${row.detail})`);
  }
  return passed === results.length;
}

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const SOCIAL_PLATFORMS = ['xiaohongshu', 'douyin', 'github', 'email', 'wechat', 'weibo', 'bilibili', 'link'];

export default function Settings({ status, onRefresh }) {
  const [settings, setSettings] = useState(null);
  const [social, setSocial] = useState([]);
  const [apiInfo, setApiInfo] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [passwords, setPasswords] = useState({ current: '', next: '' });

  const load = useCallback(async () => {
    try {
      const data = await api.settings();
      setSettings(data.settings);
      setSocial(data.social || []);
      setApiInfo(data.api);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!settings) return <div className="empty">正在加载…</div>;

  const update = (key, value) => setSettings({ ...settings, [key]: value });

  const save = async () => {
    setError('');
    setNotice('');
    try {
      const data = await api.saveSettings({ settings, social });
      setSettings(data.settings);
      setSocial(data.social || []);
      setNotice('已保存');
      onRefresh?.();
      setTimeout(() => setNotice(''), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h1 className="admin-page-title">网站设置</h1>
      <p className="admin-page-note">只保留真正需要的项。</p>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {notice ? <div className="alert alert--ok">{notice}</div> : null}

      <div className="card">
        <h2 className="card__title">基本</h2>
        <div className="field-row">
          <div className="field">
            <label>站点名称</label>
            <input value={settings['site.title']} onChange={(e) => update('site.title', e.target.value)} />
          </div>
          <div className="field">
            <label>我的名字</label>
            <input value={settings['site.name']} onChange={(e) => update('site.name', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>handle（页尾显示）</label>
            <input value={settings['site.handle']} onChange={(e) => update('site.handle', e.target.value)} />
          </div>
          <div className="field">
            <label>域名</label>
            <input value={settings['site.domain']} onChange={(e) => update('site.domain', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>一句话（首页）</label>
          <input value={settings['site.tagline']} onChange={(e) => update('site.tagline', e.target.value)} />
        </div>
        <div className="field">
          <label>站点描述（SEO 默认）</label>
          <textarea
            rows={2}
            value={settings['site.description']}
            onChange={(e) => update('site.description', e.target.value)}
          />
        </div>
        <div className="field">
          <label>默认分享图（可选）</label>
          <input
            value={settings['seo.defaultImage']}
            onChange={(e) => update('seo.defaultImage', e.target.value)}
            placeholder="https://…/share.jpg"
          />
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">世界切换</h2>
        <div className="field">
          <label>默认世界</label>
          <select value={settings['world.default']} onChange={(e) => update('world.default', e.target.value)}>
            <option value="bloom">BLOOM 绽放</option>
            <option value="ink">INK 入墨</option>
          </select>
        </div>
        <p className="card__note">
          当前 BLOOM 基础视觉：{settings['bloom.image'] || '未设置'} · INK 基础视觉：
          {settings['ink.image'] || '未设置'}（在「视觉」页更换）
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">社交（最多 4 个，前台只显示图标）</h2>
        {social.map((item, index) => (
          <div className="social-row" key={item.id || `new-${index}`}>
            <select
              value={item.platform}
              onChange={(event) => {
                const next = [...social];
                next[index] = { ...item, platform: event.target.value };
                setSocial(next);
              }}
            >
              {SOCIAL_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
            <input
              placeholder="显示名（hover 用）"
              value={item.label || ''}
              onChange={(event) => {
                const next = [...social];
                next[index] = { ...item, label: event.target.value };
                setSocial(next);
              }}
            />
            <input
              placeholder="handle，如 @zhangzhongwei"
              value={item.handle || ''}
              onChange={(event) => {
                const next = [...social];
                next[index] = { ...item, handle: event.target.value };
                setSocial(next);
              }}
            />
            <input
              placeholder="链接"
              value={item.url || ''}
              onChange={(event) => {
                const next = [...social];
                next[index] = { ...item, url: event.target.value };
                setSocial(next);
              }}
            />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={Boolean(item.visible)}
                style={{ width: 'auto' }}
                onChange={(event) => {
                  const next = [...social];
                  next[index] = { ...item, visible: event.target.checked ? 1 : 0 };
                  setSocial(next);
                }}
              />
              显示
            </label>
            <input
              type="number"
              value={item.sort ?? index}
              onChange={(event) => {
                const next = [...social];
                next[index] = { ...item, sort: Number(event.target.value) };
                setSocial(next);
              }}
            />
            <button
              className="btn btn--small btn--danger"
              onClick={() => setSocial(social.filter((_, i) => i !== index))}
            >
              删除
            </button>
          </div>
        ))}
        {social.length < 4 ? (
          <button
            className="btn btn--small"
            onClick={() =>
              setSocial([
                ...social,
                { platform: 'xiaohongshu', label: '', handle: '', url: '', visible: 1, sort: social.length },
              ])
            }
          >
            添加一个
          </button>
        ) : null}
      </div>

      <div className="card">
        <h2 className="card__title">API</h2>
        <p className="card__note">这里只显示是否已配置，不回显完整密钥。</p>
        <div className="list__meta">
          <span>provider：{apiInfo?.provider}</span>
          <span>{apiInfo?.configured ? '已配置' : '未配置'}</span>
          <span>model：{apiInfo?.model}</span>
        </div>
        <p className="card__note" style={{ marginTop: 10 }}>
          在项目根目录的 <code>.env</code> 里设置 <code>IMAGE_PROVIDER=doubao</code> 与{' '}
          <code>ARK_API_KEY=…</code>，重启服务后生效。
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">数据</h2>
        <p className="card__note">
          文章内容始终是纯 Markdown，可以随时整体带走。备份包含文章、媒体、设置与视觉素材。
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn" href="/api/export/markdown">
            导出全部 Markdown（zip）
          </a>
          <a className="btn" href="/api/backup">
            下载完整备份（zip）
          </a>
          <button
            className="btn"
            onClick={async () => {
              const data = await api.searchStatus();
              alert(`已索引 ${data.indexed} 篇 / 已发布 ${data.published} 篇`);
            }}
          >
            查看搜索索引状态
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">登录密码</h2>
        <div className="field-row">
          <div className="field">
            <label>当前密码</label>
            <input
              type="password"
              value={passwords.current}
              onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
            />
          </div>
          <div className="field">
            <label>新密码（至少 8 位）</label>
            <input
              type="password"
              value={passwords.next}
              onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
            />
          </div>
        </div>
        <button
          className="btn"
          onClick={async () => {
            try {
              await api.changePassword(passwords);
              setPasswords({ current: '', next: '' });
              setNotice('密码已更新');
              setTimeout(() => setNotice(''), 2000);
            } catch (err) {
              setError(err.message);
            }
          }}
        >
          更新密码
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 40 }}>
        <button className="btn btn--primary" onClick={save}>
          保存全部设置
        </button>
        <button className="btn" onClick={load}>
          放弃修改
        </button>
      </div>
    </div>
  );
}

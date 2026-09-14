import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export default function Visuals() {
  const [world, setWorld] = useState('bloom');
  const [rows, setRows] = useState([]);
  const [apiInfo, setApiInfo] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [visuals, settings] = await Promise.all([api.visuals(world), api.settings()]);
      setRows(visuals.rows || []);
      setApiInfo(visuals.api);
      setPrompt(settings.settings[`${world}.prompt`] || '');
    } catch (err) {
      setError(err.message);
    }
  }, [world]);

  useEffect(() => {
    load();
  }, [load]);

  const active = rows.find((row) => row.active);

  const generate = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.generateVisuals({ world, prompt, count: 3 });
      await load();
      setNotice('已生成新的候选，挑一个设为当前。');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="admin-page-title">视觉</h1>
      <p className="admin-page-note">
        生成图只是原料。前台会用 WebGL 把它吸收进画面：有机噪声、位移、柔光、粒子与视差。
      </p>

      <div className="tabs">
        <button className={world === 'bloom' ? 'is-active' : ''} onClick={() => setWorld('bloom')}>
          BLOOM 绽放
        </button>
        <button className={world === 'ink' ? 'is-active' : ''} onClick={() => setWorld('ink')}>
          INK 入墨
        </button>
      </div>

      <div className="card">
        <h2 className="card__title">生成描述</h2>
        <p className="card__note">
          当前 provider：{apiInfo?.provider}，
          {apiInfo?.configured ? '已配置' : '未配置（用本地程序化生成，不需要任何 API Key）'}
        </p>
        <div className="field">
          <textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <span className="field__hint">
            未配置 API 时仍然可生成：本地会程序化画出一张同气质的基础视觉。
          </span>
        </div>
        <button className="btn btn--primary" disabled={busy} onClick={generate}>
          {busy ? '生成中…' : '生成 3 张候选'}
        </button>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {notice ? <div className="alert alert--ok">{notice}</div> : null}

      {active ? (
        <div className="card">
          <h2 className="card__title">当前使用</h2>
          <img
            src={active.url}
            alt=""
            style={{ width: '100%', maxWidth: 640, borderRadius: 4, display: 'block' }}
          />
          <p className="card__note" style={{ marginTop: 10 }}>
            {active.provider} · {new Date(active.created_at).toLocaleString('zh-CN')}
          </p>
        </div>
      ) : null}

      <div className="card">
        <h2 className="card__title">历史素材（不会覆盖旧图）</h2>
        {rows.length === 0 ? <p className="empty">还没有素材，先生成一张。</p> : null}
        <div className="visual-grid">
          {rows.map((row) => (
            <div className={`visual-card${row.active ? ' is-active' : ''}`} key={row.id}>
              <img src={row.thumb || row.url} alt="" loading="lazy" />
              <div className="visual-card__body">
                <span>{new Date(row.created_at).toLocaleString('zh-CN')}</span>
                <span className="visual-card__prompt">{row.prompt}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn--small"
                    disabled={row.active}
                    onClick={async () => {
                      await api.activateVisual(row.id);
                      await load();
                    }}
                  >
                    {row.active ? '使用中' : '设为当前'}
                  </button>
                  <button
                    className="btn btn--small btn--danger"
                    onClick={async () => {
                      if (!window.confirm('删除这张素材？')) return;
                      await api.deleteVisual(row.id);
                      await load();
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

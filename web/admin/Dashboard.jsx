import { useEffect, useState } from 'react';
import { api, SECTIONS } from './api.js';

export default function Dashboard({ status, navigate, onRefresh }) {
  const [recent, setRecent] = useState([]);
  const [search, setSearch] = useState(status.search);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .articles({ limit: 8 })
      .then((data) => setRecent(data.rows || []))
      .catch(() => {});
  }, []);

  const stats = status.stats || { bySection: [], trash: 0, total: 0, words: 0 };
  const countFor = (key) =>
    (stats.bySection || [])
      .filter((row) => row.section === key && row.status === 'published')
      .reduce((sum, row) => sum + row.n, 0);

  return (
    <div>
      <h1 className="admin-page-title">概览</h1>
      <p className="admin-page-note">只放真正需要的东西：写、看、上传、设置。</p>

      <div className="stat-row">
        <div className="stat">
          <div className="stat__value">{stats.total}</div>
          <div className="stat__label">文章总数</div>
        </div>
        {SECTIONS.map((item) => (
          <div className="stat" key={item.key}>
            <div className="stat__value" style={{ color: item.accent }}>
              {countFor(item.key)}
            </div>
            <div className="stat__label">{item.name}（已发布）</div>
          </div>
        ))}
        <div className="stat">
          <div className="stat__value">{stats.trash}</div>
          <div className="stat__label">回收站</div>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">最近写的</h2>
        <div className="list">
          {recent.map((row) => (
            <div className="list__row" key={row.id}>
              <span className="list__title">
                <a
                  href={`/admin/articles/${row.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`articles/${row.id}`);
                  }}
                >
                  {row.title || '(无标题)'}
                </a>
              </span>
              <span className="list__meta">
                <span>{(row.published_at || '').slice(0, 10)}</span>
              </span>
            </div>
          ))}
          {recent.length === 0 ? <p className="empty">还没有文章。</p> : null}
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">搜索索引</h2>
        <p className="card__note">
          文章发布、修改、删除后会自动更新索引。这里是当前状态。
        </p>
        <div className="list__meta" style={{ marginBottom: 12 }}>
          <span>已索引 {search?.indexed ?? 0} 篇</span>
          <span>已发布 {search?.published ?? 0} 篇</span>
          <span>最后更新：{search?.lastUpdated ? new Date(search.lastUpdated).toLocaleString('zh-CN') : '—'}</span>
        </div>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const data = await api.rebuildSearch();
              setSearch(data);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '重建中…' : '重新构建索引'}
        </button>
      </div>

      <div className="card">
        <h2 className="card__title">图像生成 API</h2>
        <p className="card__note">
          服务端读取环境变量里的密钥，网页里永远看不到 Secret。
        </p>
        <div className="list__meta">
          <span>provider：{status.api?.provider}</span>
          <span>{status.api?.configured ? '已配置' : '未配置（可用本地程序化生成）'}</span>
          <span>model：{status.api?.model}</span>
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('visuals')}>
          去视觉页
        </button>
      </div>

      <button className="btn" onClick={onRefresh}>
        刷新数据
      </button>
    </div>
  );
}

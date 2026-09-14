import { useCallback, useEffect, useState } from 'react';
import { api, SECTIONS, STATUS_LABELS, sectionName } from './api.js';

const STATUS_CLASS = {
  draft: 'tag--draft',
  published: 'tag--published',
  scheduled: 'tag--scheduled',
};

export default function Articles({ mode, navigate, query, onRefresh }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [section, setSection] = useState('');
  const [status, setStatus] = useState('');
  const [trash, setTrash] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.articles({ section, status, q: query, trash: trash ? 1 : '', limit: 120 });
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [section, status, trash, query]);

  useEffect(() => {
    if (mode !== 'new') load();
  }, [load, mode]);

  const flash = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2400);
  };

  const trashArticle = async (row) => {
    const ok = window.confirm(`把《${row.title || '这篇'}》放进回收站？\n\n删除后可以在「回收站」里恢复。`);
    if (!ok) return;
    await api.trashArticle(row.id);
    flash('已放进回收站，可在「回收站」里恢复');
    load();
    onRefresh?.();
  };

  const purgeArticle = async (row) => {
    const ok = window.confirm(`彻底删除《${row.title || '这篇'}》？\n\n这一步无法撤销。`);
    if (!ok) return;
    await api.purgeArticle(row.id);
    load();
    onRefresh?.();
  };

  if (mode === 'new') {
    return (
      <div>
        <h1 className="admin-page-title">新建文章</h1>
        <p className="admin-page-note">先选一个栏目，四种内容用的是同一套文章模型。</p>
        <div className="stat-row">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className="stat"
              style={{ textAlign: 'left', background: '#fff' }}
              onClick={async () => {
                const { article } = await api.createArticle({ title: '未命名', section: item.key });
                onRefresh?.();
                navigate(`articles/${article.id}`);
              }}
            >
              <div className="stat__value" style={{ color: item.accent }}>
                {item.name}
              </div>
              <div className="stat__label">{item.question || '世界与我暂时没有关系'}</div>
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => navigate('articles')}>
          返回文章列表
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="admin-page-title">文章</h1>
      <p className="admin-page-note">
        共 {total} 篇{query ? `（匹配「${query}」）` : ''} · 点标题或「编辑」都能进编辑器
      </p>

      <div className="tabs">
        <button
          className={!section && !trash && !status ? 'is-active' : ''}
          onClick={() => {
            setSection('');
            setStatus('');
            setTrash(false);
          }}
        >
          全部
        </button>
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            className={section === item.key && !trash ? 'is-active' : ''}
            onClick={() => {
              setSection(item.key);
              setTrash(false);
              setStatus('');
            }}
          >
            {item.name}
          </button>
        ))}
        <button
          className={status === 'draft' ? 'is-active' : ''}
          onClick={() => {
            setStatus('draft');
            setTrash(false);
          }}
        >
          草稿
        </button>
        <button
          className={trash ? 'is-active' : ''}
          onClick={() => {
            setTrash(true);
            setStatus('');
            setSection('');
          }}
        >
          回收站
        </button>
        {trash && rows.length > 0 ? (
          <button
            style={{ marginLeft: 'auto', color: '#b4453f' }}
            onClick={async () => {
              if (!window.confirm('彻底清空回收站？这一步无法撤销。')) return;
              await api.emptyTrash();
              load();
              onRefresh?.();
            }}
          >
            清空回收站
          </button>
        ) : null}
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {notice ? <div className="alert alert--ok">{notice}</div> : null}

      {loading ? <p className="empty">正在加载…</p> : null}
      {!loading && rows.length === 0 ? <p className="empty">这里还没有文章。</p> : null}

      <div className="list">
        {rows.map((row) => (
          <div className="list__row" key={row.id}>
            <span className="list__title">
              {trash ? (
                <span>{row.title || '(无标题)'}</span>
              ) : (
                <a
                  href={`/admin/articles/${row.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`articles/${row.id}`);
                  }}
                >
                  {row.title || '(无标题)'}
                </a>
              )}
            </span>
            <span className="list__meta">
              <span className="tag">{sectionName(row.section)}</span>
              <span className={`tag ${STATUS_CLASS[row.status] || ''}`}>
                {STATUS_LABELS[row.status] || row.status}
              </span>
              <span>{(row.published_at || '').slice(0, 10)}</span>
              <span>{row.word_count} 字</span>
            </span>
            <span className="list__actions">
              {trash ? (
                <>
                  <button
                    className="btn btn--small"
                    onClick={async () => {
                      await api.restoreArticle(row.id);
                      flash('已从回收站恢复');
                      load();
                      onRefresh?.();
                    }}
                  >
                    恢复
                  </button>
                  <button className="btn btn--small btn--danger" onClick={() => purgeArticle(row)}>
                    彻底删除
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn btn--small btn--primary"
                    onClick={() => navigate(`articles/${row.id}`)}
                  >
                    编辑
                  </button>
                  <a className="btn btn--small" href={`/${row.section}/${row.slug}/`} target="_blank" rel="noreferrer">
                    查看
                  </a>
                  <button className="btn btn--small btn--danger" onClick={() => trashArticle(row)}>
                    删除
                  </button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

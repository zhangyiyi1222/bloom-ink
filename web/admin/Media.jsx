import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadFile } from './api.js';

function markdownFor(item, variant) {
  const alt = item.alt || (item.original_name || '').replace(/\.[^.]+$/, '');
  const caption = item.caption ? ` "${item.caption.replace(/"/g, '')}"` : '';
  const url = item.kind === 'image' ? item.webp || item.url : item.url;
  const suffix = variant ? `{.{variant}}`.replace('{variant}', variant) : '';
  return `![${alt}](${url}${caption})${suffix}`;
}

export default function Media() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ alt: '', caption: '', original_name: '' });
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.media({ kind, q: query, limit: 200 });
      setRows(data.rows || []);
      setStats(data.stats);
    } catch (err) {
      setError(err.message);
    }
  }, [kind, query]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of files) {
        await uploadFile(file, setProgress);
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制 Markdown');
      setTimeout(() => setNotice(''), 1600);
    } catch {
      setNotice('复制失败');
    }
  };

  const totalBytes = stats?.total?.bytes || 0;

  return (
    <div
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (event.dataTransfer?.files?.length) {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }
      }}
    >
      <h1 className="admin-page-title">媒体</h1>
      <p className="admin-page-note">
        共 {stats?.total?.n || 0} 个文件，约 {Math.round(totalBytes / 1024 / 1024)} MB。上传后会自动生成
        WebP 优化版本与缩略图。
      </p>

      <div className={`dropzone${dragging ? ' is-over' : ''}`}>
        <div>把图片、视频、音频拖到这里，或者</div>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()}>
          选择文件
        </button>
        {busy ? (
          <div className="progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      <div className="tabs">
        {[
          { key: '', label: '全部' },
          { key: 'image', label: '图片' },
          { key: 'video', label: '视频' },
          { key: 'audio', label: '音频' },
        ].map((item) => (
          <button
            key={item.key}
            className={kind === item.key ? 'is-active' : ''}
            onClick={() => setKind(item.key)}
          >
            {item.label}
          </button>
        ))}
        <input
          type="search"
          placeholder="搜索文件名 / alt"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ marginLeft: 'auto', padding: '4px 8px', border: '1px solid #e6e6e6', borderRadius: 4 }}
        />
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {notice ? <div className="alert alert--ok">{notice}</div> : null}

      {rows.length === 0 ? <p className="empty">还没有文件。</p> : null}

      <div className="media-grid">
        {rows.map((item) => (
          <div
            key={item.id}
            className={`media-card${selected?.id === item.id ? ' is-selected' : ''}`}
            onClick={() => {
              setSelected(item);
              setDraft({
                alt: item.alt || '',
                caption: item.caption || '',
                original_name: item.original_name || '',
              });
            }}
          >
            <div className="media-card__thumb">
              {item.kind === 'image' ? (
                <img src={item.thumb} alt="" loading="lazy" />
              ) : (
                <span style={{ fontSize: 12, color: '#9a9a9a' }}>{item.kind}</span>
              )}
              <span className="media-card__kind">{item.kind}</span>
            </div>
            <div className="media-card__body">
              <span className="media-card__name">{item.original_name || item.filename}</span>
              <span>
                {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                {Math.round((item.size || 0) / 1024)} KB
              </span>
              <div className="media-card__actions">
                <button className="btn btn--small" onClick={() => copy(markdownFor(item))}>
                  复制 Markdown
                </button>
                <button
                  className="btn btn--small btn--danger"
                  onClick={async () => {
                    if (!window.confirm('删除这个文件？（先放进回收，不物理删除）')) return;
                    await api.deleteMedia(item.id);
                    setSelected(null);
                    load();
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="card__title">文件信息</h2>
          <div className="field">
            <label>访问地址</label>
            <input readOnly value={selected.url} onFocus={(event) => event.target.select()} />
          </div>
          <div className="field">
            <label>alt（图片说明，给搜索和读屏用）</label>
            <input
              value={draft.alt}
              onChange={(event) => setDraft({ ...draft, alt: event.target.value })}
            />
          </div>
          <div className="field">
            <label>caption（显示在图下方，不填就不留位置）</label>
            <input
              value={draft.caption}
              onChange={(event) => setDraft({ ...draft, caption: event.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn--primary"
              onClick={async () => {
                await api.updateMedia(selected.id, draft);
                await load();
                setNotice('已保存');
                setTimeout(() => setNotice(''), 1600);
              }}
            >
              保存信息
            </button>
            {selected.kind === 'image' ? (
              <>
                <button
                  className="btn"
                  onClick={() => copy(markdownFor({ ...selected, ...draft }, 'wide'))}
                >
                  复制宽图 Markdown
                </button>
                <button
                  className="btn"
                  onClick={() => copy(markdownFor({ ...selected, ...draft }, 'full'))}
                >
                  复制满宽 Markdown
                </button>
              </>
            ) : null}
            <button
              className="btn btn--danger"
              onClick={async () => {
                if (!window.confirm('彻底删除这个文件？无法恢复。')) return;
                await api.deleteMedia(selected.id, true);
                setSelected(null);
                load();
              }}
            >
              彻底删除
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 文章里的照片统一收在正文宽度里，所以“宽图 / 满宽”这两个写法不再产生区别。
 * 这里覆盖一下，避免再往 Markdown 里写入已经没用的修饰符。
 * ------------------------------------------------------------------ */
const __markdownForMedia = markdownFor;
markdownFor = function markdownForCapped(item) {
  return __markdownForMedia(item);
};

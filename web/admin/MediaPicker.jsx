import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadFile } from './api.js';

/** 媒体库弹窗：给编辑器选图用，也用于视频 / 音频。 */
export default function MediaPicker({ kind, onPick, onClose }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.media({ kind: kind || '', q: query, limit: 120 });
      setRows(data.rows || []);
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
      setProgress(0);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const markdownFor = (item) => {
    const alt = item.alt || item.original_name || '';
    const caption = item.caption ? ` "${item.caption.replace(/"/g, '')}"` : '';
    const url = item.kind === 'image' ? item.webp || item.url : item.url;
    return `![${alt}](${url}${caption})`;
  };

  return (
    <div className="modal">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
        <div className="modal__head">
          <span className="modal__title">媒体库</span>
          <input
            type="search"
            placeholder="搜索文件名"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ marginLeft: 12, padding: '4px 8px', border: '1px solid #e6e6e6', borderRadius: 4 }}
          />
          <button className="btn btn--small" onClick={() => fileRef.current?.click()}>
            上传文件
          </button>
          <button className="modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal__body">
          {error ? <div className="alert alert--error">{error}</div> : null}
          {busy ? (
            <div className="progress">
              <span style={{ width: `${progress}%` }} />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <p className="empty">还没有文件。可以直接把图片拖进来。</p>
          ) : (
            <div className="media-grid">
              {rows.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`media-card${selected?.id === item.id ? ' is-selected' : ''}`}
                  onClick={() => setSelected(item)}
                  onDoubleClick={() => onPick(markdownFor(item))}
                  style={{ textAlign: 'left' }}
                >
                  <span className="media-card__thumb">
                    {item.kind === 'image' ? (
                      <img src={item.thumb} alt="" loading="lazy" />
                    ) : (
                      <span style={{ fontSize: 12, color: '#9a9a9a' }}>{item.kind}</span>
                    )}
                    <span className="media-card__kind">{item.kind}</span>
                  </span>
                  <span className="media-card__body">
                    <span className="media-card__name">{item.original_name || item.filename}</span>
                    <span>
                      {item.width && item.height ? `${item.width}×${item.height}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={kind === 'image' ? 'image/*' : undefined}
            onChange={(event) => handleFiles(event.target.files)}
          />
        </div>
        <div className="modal__head" style={{ borderTop: '1px solid #e6e6e6', borderBottom: 0 }}>
          <span style={{ fontSize: 12, color: '#9a9a9a' }}>
            {selected ? `已选：${selected.original_name || selected.filename}` : '双击图片直接插入'}
          </span>
          <button
            className="btn btn--primary"
            style={{ marginLeft: 'auto' }}
            disabled={!selected}
            onClick={() => {
              if (selected) onPick(markdownFor(selected));
            }}
          >
            插入正文
          </button>
        </div>
      </div>
    </div>
  );
}

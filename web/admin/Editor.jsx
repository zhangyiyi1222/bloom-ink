import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadFile, SECTIONS, STATUS_LABELS, toInputValue, fromInputValue } from './api.js';
import MarkdownEditor from './MarkdownEditor.jsx';
import MediaPicker from './MediaPicker.jsx';

const TABLE_TEMPLATE = `
| 列一 | 列二 |
| --- | --- |
| 内容 | 内容 |
`;

const FOOTNOTE_TEMPLATE = `
这里引用一个脚注[^1]。

[^1]: 脚注内容写在这里。
`;

function markdownForMedia(media) {
  const alt = media.alt || (media.original_name || '').replace(/\.[^.]+$/, '') || '';
  const caption = media.caption ? ` "${media.caption.replace(/"/g, '')}"` : '';
  const url = media.kind === 'image' ? media.webp || media.url : media.url;
  return `![${alt}](${url}${caption})`;
}

export default function Editor({ id, navigate, onRefresh }) {
  const [article, setArticle] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(() => window.innerWidth >= 1100);
  const [previewMobile, setPreviewMobile] = useState(false);
  const [showMeta, setShowMeta] = useState(true);
  const [picker, setPicker] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const editorApi = useRef(null);
  const dirty = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    api
      .article(id)
      .then(({ article: data }) => {
        if (alive) setArticle(data);
      })
      .catch((err) => setError(err.message));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const warn = (event) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const save = useCallback(async () => {
    if (!article) return;
    setSaveState('saving');
    try {
      const { article: saved } = await api.saveArticle(article.id, {
        title: article.title,
        slug: article.slug,
        section: article.section,
        content: article.content,
        status: article.status,
        published_at: article.published_at,
        tags: article.tags,
        seo_description: article.seo_description,
      });
      dirty.current = false;
      setArticle((prev) => ({ ...prev, ...saved }));
      setSaveState('saved');
      setSavedAt(Date.now());
    } catch (err) {
      setSaveState('error');
      setError(err.message);
    }
  }, [article]);

  // 自动保存：停手 1.4 秒后写一次，状态一直显示给写作者看
  useEffect(() => {
    if (!article || !dirty.current) return undefined;
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      save();
    }, 1400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [article, save]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const patch = (fields) => {
    dirty.current = true;
    setArticle((prev) => ({ ...prev, ...fields }));
  };

  const uploadFiles = async (files) => {
    const lines = [];
    try {
      for (const file of files) {
        const media = await uploadFile(file, setProgress);
        lines.push(markdownForMedia(media));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(0);
    }
    return lines;
  };

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      const { article: saved } = await api.setArticleStatus(article.id, {
        status,
        published_at: status === 'scheduled' ? article.published_at : new Date().toISOString(),
      });
      setArticle(saved);
      dirty.current = false;
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      onRefresh?.();
    }
  };

  const removeArticle = async () => {
    if (!window.confirm('把这篇放进回收站？之后可以恢复。')) return;
    await api.trashArticle(article.id).catch((err) => setError(err.message));
    dirty.current = false;
    onRefresh?.();
    navigate('articles');
  };

  const openRevisions = async () => {
    const { revisions: rows } = await api.revisions(article.id);
    setRevisions(rows);
    setShowRevisions(true);
  };

  if (error && !article) return <div className="alert alert--error">{error}</div>;
  if (!article) return <div className="empty">正在打开…</div>;

  const statusLabel =
    saveState === 'saving' ? '保存中' : saveState === 'error' ? '保存失败' : dirty.current ? '未保存' : '已保存';

  return (
    <div className="editor">
      <div className="editor__bar">
        <input
          className="editor__title-input"
          value={article.title}
          placeholder="标题"
          onChange={(event) => patch({ title: event.target.value })}
        />
        <span className={`editor__status${saveState === 'saving' ? ' is-saving' : ''}${saveState === 'error' ? ' is-error' : ''}`}>
          {statusLabel}
        </span>
        <button className="btn btn--small" onClick={() => setShowMeta((v) => !v)}>
          {showMeta ? '收起字段' : '字段'}
        </button>
        <button className="btn btn--small" onClick={openRevisions}>
          版本
        </button>
        <button
          className="btn btn--small"
          onClick={() => setShowPreview((v) => !v)}
          title="使用真实前台页面预览"
        >
          {showPreview ? '关闭预览' : '预览'}
        </button>
        <button className="btn btn--small" onClick={() => window.open(`/preview/${article.id}`, '_blank')}>
          新窗口预览
        </button>
        {article.status === 'published' ? (
          <button className="btn btn--small" disabled={busy} onClick={() => changeStatus('draft')}>
            转为草稿
          </button>
        ) : (
          <button className="btn btn--primary btn--small" disabled={busy} onClick={() => changeStatus('published')}>
            发布
          </button>
        )}
        <button className="btn btn--small btn--danger" onClick={removeArticle}>
          删除
        </button>
      </div>

      <div className={`editor__body${showPreview ? ' has-preview' : ''}`}>
        <div className="editor__pane">
          <div className="editor__tools">
            <button onClick={() => editorApi.current?.prefixLines('## ')}>H2</button>
            <button onClick={() => editorApi.current?.prefixLines('### ')}>H3</button>
            <button onClick={() => editorApi.current?.prefixLines('#### ')}>H4</button>
            <span className="sep" />
            <button onClick={() => editorApi.current?.wrap('**', '**', '粗体')}>
              <strong>B</strong>
            </button>
            <button onClick={() => editorApi.current?.wrap('*', '*', '斜体')}>
              <em>I</em>
            </button>
            <button onClick={() => editorApi.current?.wrap('~~', '~~', '删除线')}>
              <s>S</s>
            </button>
            <button onClick={() => editorApi.current?.wrap('`', '`', 'code')}>行内代码</button>
            <span className="sep" />
            <button onClick={() => editorApi.current?.prefixLines('> ')}>引用</button>
            <button onClick={() => editorApi.current?.prefixLines('- ')}>无序列表</button>
            <button onClick={() => editorApi.current?.prefixLines('1. ')}>有序列表</button>
            <span className="sep" />
            <button
              onClick={() =>
                editorApi.current?.wrap('[', '](https://)', '链接文字')
              }
            >
              链接
            </button>
            <button onClick={() => setPicker({ kind: 'image' })}>图片</button>
            <button onClick={() => setPicker({ kind: 'video' })}>视频</button>
            <button onClick={() => setPicker({ kind: 'audio' })}>音频</button>
            <button onClick={() => editorApi.current?.insert(TABLE_TEMPLATE)}>表格</button>
            <button onClick={() => editorApi.current?.insert('\n---\n')}>分割线</button>
            <button onClick={() => editorApi.current?.insert(FOOTNOTE_TEMPLATE)}>脚注</button>
            <button onClick={() => editorApi.current?.insert('\n$$\nE = mc^2\n$$\n')}>公式</button>
            <button
              onClick={() => editorApi.current?.insert('\nhttps://www.bilibili.com/video/BVxxxxxxxxx\n')}
            >
              嵌入
            </button>
            <span className="sep" />
          </div>

          <MarkdownEditor
            value={article.content}
            onChange={(value) => patch({ content: value })}
            onUploadFiles={uploadFiles}
            onReady={(apiRef) => {
              editorApi.current = apiRef;
            }}
          />
          {progress > 0 ? (
            <div className="progress">
              <span style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>

        {showPreview ? (
          <div className="editor__preview">
            <div className="editor__preview-bar">
              <span>真实前台预览</span>
              <button className="btn btn--small" onClick={() => setPreviewMobile(false)}>
                桌面
              </button>
              <button className="btn btn--small" onClick={() => setPreviewMobile(true)}>
                手机
              </button>
              <button className="btn btn--small" onClick={() => setSavedAt(Date.now())} style={{ marginLeft: 'auto' }}>
                刷新
              </button>
            </div>
            <div className={`editor__preview-frame${previewMobile ? ' is-mobile' : ''}`}>
              <iframe
                key={savedAt}
                title="预览"
                src={`/preview/${article.id}?v=${savedAt}`}
                sandbox="allow-same-origin allow-popups"
              />
            </div>
          </div>
        ) : null}
      </div>

      {showMeta ? (
        <div className="editor__meta">
          <div className="field">
            <label>slug（URL 段）</label>
            <input value={article.slug} onChange={(event) => patch({ slug: event.target.value })} />
            <span className="field__hint">可留中文，也可以用英文更通用。</span>
          </div>
          <div className="field">
            <label>发布日期与时间</label>
            <input
              type="datetime-local"
              value={toInputValue(article.published_at)}
              onChange={(event) => patch({ published_at: fromInputValue(event.target.value) })}
            />
          </div>
          <div className="field">
            <label>栏目</label>
            <select value={article.section} onChange={(event) => patch({ section: event.target.value })}>
              {SECTIONS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>状态</label>
            <select value={article.status} onChange={(event) => patch({ status: event.target.value })}>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>标签（后台用，前台默认不显示）</label>
            <input value={article.tags || ''} onChange={(event) => patch({ tags: event.target.value })} />
          </div>
          <div className="field">
            <label>SEO 描述（可选）</label>
            <textarea
              value={article.seo_description || ''}
              onChange={(event) => patch({ seo_description: event.target.value })}
              rows={2}
            />
          </div>
          <div className="field">
            <span className="field__hint">
            </span>
          </div>
        </div>
      ) : null}

      {picker ? (
        <MediaPicker
          kind={picker.kind}
          onClose={() => setPicker(null)}
          onPick={(markdown) => {
            editorApi.current?.insert(markdown);
            setPicker(null);
          }}
        />
      ) : null}

      {showRevisions ? (
        <div className="modal">
          <div className="modal__backdrop" onClick={() => setShowRevisions(false)} />
          <div className="modal__panel modal__panel--narrow">
            <div className="modal__head">
              <span className="modal__title">版本历史</span>
              <button className="modal__close" onClick={() => setShowRevisions(false)}>
                ×
              </button>
            </div>
            <div className="modal__body">
              {revisions.length === 0 ? (
                <p className="empty">还没有历史版本。</p>
              ) : (
                <div className="rev-list">
                  {revisions.map((row) => (
                    <div className="rev-row" key={row.id}>
                      <span>{new Date(row.created_at).toLocaleString('zh-CN')}</span>
                      <span style={{ color: '#9a9a9a' }}>{row.word_count} 字</span>
                      <button
                        className="btn btn--small"
                        style={{ marginLeft: 'auto' }}
                        onClick={async () => {
                          const { article: restored } = await api.restoreRevision(article.id, row.id);
                          setArticle(restored);
                          dirty.current = false;
                          setSavedAt(Date.now());
                          setShowRevisions(false);
                        }}
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 粘贴 / 拖拽上传的图片：前面先断开一行再插入。
 * 否则如果光标正好停在一行非空文字的末尾（比如代码围栏那一行），
 * 图片就会插进代码块里，看起来像“上传成功了但没显示”。
 * ------------------------------------------------------------------ */
const __markdownForMedia = markdownForMedia;
markdownForMedia = function markdownForMediaBlock(media) {
  return `\n\n${__markdownForMedia(media)}`;
};

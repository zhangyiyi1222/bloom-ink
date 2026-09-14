import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';

/**
 * Markdown 是唯一真实内容格式；这里提供的是“所见即所得辅助编辑”的输入侧：
 * 语法高亮、快捷键、粘贴/拖拽图片直接上传。
 */
export default function MarkdownEditor({ value, onChange, onUploadFiles, onReady }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const changeRef = useRef(onChange);
  const uploadRef = useRef(onUploadFiles);

  changeRef.current = onChange;
  uploadRef.current = onUploadFiles;

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const state = EditorState.create({
      doc: value || '',
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        cmPlaceholder('在这里写。Markdown 会被原样保存，随时可以导出。'),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changeRef.current(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    const insert = (text) => {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      });
      view.focus();
    };

    const wrap = (before, after, fallback) => {
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to) || fallback || '';
      const text = `${before}${selected}${after}`;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + before.length, head: from + before.length + selected.length },
        scrollIntoView: true,
      });
      view.focus();
    };

    const prefixLines = (prefix) => {
      const { from, to } = view.state.selection.main;
      const startLine = view.state.doc.lineAt(from);
      const endLine = view.state.doc.lineAt(to);
      const changes = [];
      for (let n = startLine.number; n <= endLine.number; n++) {
        const line = view.state.doc.line(n);
        const existing = line.text.match(/^(\s*)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s)?/);
        const indent = existing ? existing[1] : '';
        const hasPrefix = existing && existing[2];
        changes.push({
          from: line.from + indent.length,
          to: line.from + indent.length + (hasPrefix ? hasPrefix.length : 0),
          insert: prefix,
        });
      }
      view.dispatch({ changes, scrollIntoView: true });
      view.focus();
    };

    const uploadFiles = async (files) => {
      if (!files || !files.length || !uploadRef.current) return;
      const lines = await uploadRef.current([...files]);
      if (lines && lines.length) {
        const { from, to } = view.state.selection.main;
        const text = lines.join('\n');
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          scrollIntoView: true,
        });
      }
      view.focus();
    };

    const onPaste = (event) => {
      const items = event.clipboardData?.items || [];
      const files = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) {
        event.preventDefault();
        uploadFiles(files);
      }
    };

    const onDrop = (event) => {
      const files = event.dataTransfer?.files;
      if (files && files.length) {
        event.preventDefault();
        uploadFiles(files);
      }
    };
    const onDragOver = (event) => {
      if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
    };

    view.dom.addEventListener('paste', onPaste);
    view.dom.addEventListener('drop', onDrop);
    view.dom.addEventListener('dragover', onDragOver);

    onReady?.({ insert, wrap, prefixLines, focus: () => view.focus() });

    return () => {
      view.dom.removeEventListener('paste', onPaste);
      view.dom.removeEventListener('drop', onDrop);
      view.dom.removeEventListener('dragover', onDragOver);
      view.destroy();
      viewRef.current = null;
    };
    // 只在挂载时初始化编辑器；外部内容变化通过下面的 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if ((value || '') !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value || '' } });
    }
  }, [value]);

  return <div className="editor__source" ref={hostRef} />;
}

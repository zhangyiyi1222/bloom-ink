import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './admin.css';
import { api, SECTIONS } from './api.js';
import Dashboard from './Dashboard.jsx';
import Articles from './Articles.jsx';
import Editor from './Editor.jsx';
import Media from './Media.jsx';
import Visuals from './Visuals.jsx';
import Settings from './Settings.jsx';

/* ------------------------------ 极简路由 ------------------------------ */

function readRoute() {
  const path = window.location.pathname.replace(/^\/admin\/?/, '');
  const parts = path.split('/').filter(Boolean);
  return { parts, path };
}

function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  const navigate = useCallback((to) => {
    const url = to.startsWith('/') ? to : `/admin/${to}`;
    window.history.pushState({}, '', url);
    setRoute(readRoute());
  }, []);
  return { route, navigate };
}

/* ------------------------------- 登录 ------------------------------- */

function Login({ needsSetup, onDone }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (needsSetup && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      if (needsSetup) await api.setup({ username, password });
      else await api.login({ username, password });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login__panel" onSubmit={submit}>
        <h1 className="login__title">{needsSetup ? '创建管理员' : '登录后台'}</h1>
        <p className="login__note">
          {needsSetup
            ? '这是第一次打开后台，先设置一个你自己的密码（至少 8 位）。'
            : '只有登录以后才能写文章、上传图片和修改设置。'}
        </p>
        {error ? <div className="alert alert--error">{error}</div> : null}
        <div className="field">
          <label>用户名</label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="field">
          <label>密码</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
          />
        </div>
        {needsSetup ? (
          <div className="field">
            <label>再输一次</label>
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </div>
        ) : null}
        <button className="btn btn--primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? '处理中…' : needsSetup ? '创建并进入' : '登录'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------- 外壳 ------------------------------- */

const NAV = [
  { key: '', label: '概览' },
  { key: 'articles', label: '文章' },
  { key: 'media', label: '媒体' },
  { key: 'visuals', label: '视觉' },
  { key: 'settings', label: '设置' },
];

function Shell({ route, navigate, status, onLogout, children, query, setQuery }) {
  const active = route.parts[0] || '';
  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <div className="admin-brand">
          <strong>一个人像一朵花</strong>
          <span>{status?.user?.username || ''}</span>
        </div>
        <nav className="admin-nav">
          {NAV.map((item) => (
            <a
              key={item.key}
              href={`/admin/${item.key}`}
              className={active === item.key ? 'is-active' : ''}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.key);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="admin-side__foot">
          <a href="/" target="_blank" rel="noreferrer">
            打开前台 ↗
          </a>
          <a
            href="/admin"
            onClick={(event) => {
              event.preventDefault();
              onLogout();
            }}
          >
            退出登录
          </a>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-top">
          <div className="admin-top__search">
            <input
              type="search"
              placeholder="搜索文章"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => {
                if (active !== 'articles' && active !== '') navigate('articles');
              }}
            />
          </div>
          <div className="admin-top__right">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => navigate('articles/new')}
            >
              新建文章
            </button>
          </div>
        </header>
        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------- 应用 ------------------------------- */

function App() {
  const { route, navigate } = useRoute();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.status();
      setStatus(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const logout = async () => {
    await api.logout().catch(() => {});
    await loadStatus();
    navigate('');
  };

  if (!status) {
    return <div className="empty">正在加载…</div>;
  }

  if (!status.loggedIn) {
    return <Login needsSetup={status.needsSetup} onDone={() => loadStatus()} />;
  }

  const first = route.parts[0] || '';
  let page = null;

  if (first === '' ) {
    page = <Dashboard status={status} navigate={navigate} onRefresh={loadStatus} />;
  } else if (first === 'articles') {
    if (route.parts[1] === 'new') {
      page = <Articles mode="new" navigate={navigate} query={query} onRefresh={loadStatus} />;
    } else if (route.parts[1]) {
      page = (
        <Editor
          id={Number(route.parts[1])}
          navigate={navigate}
          onRefresh={loadStatus}
        />
      );
    } else {
      page = <Articles navigate={navigate} query={query} onRefresh={loadStatus} />;
    }
  } else if (first === 'media') {
    page = <Media />;
  } else if (first === 'visuals') {
    page = <Visuals />;
  } else if (first === 'settings') {
    page = <Settings status={status} onRefresh={loadStatus} />;
  } else {
    page = <div className="empty">没有这个页面。<button className="btn" onClick={() => navigate('')}>回到概览</button></div>;
  }

  return (
    <Shell
      route={route}
      navigate={navigate}
      status={status}
      onLogout={logout}
      query={query}
      setQuery={setQuery}
    >
      {error ? <div className="alert alert--error">{error}</div> : null}
      {page}
    </Shell>
  );
}

createRoot(document.getElementById('admin-root')).render(<App />);

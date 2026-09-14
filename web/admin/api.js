const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? JSON_HEADERS : {}), ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  status: () => request('/api/status'),
  setup: (body) => request('/api/setup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/api/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/api/logout', { method: 'POST' }),
  changePassword: (body) => request('/api/password', { method: 'POST', body: JSON.stringify(body) }),

  articles: (params) => request(`/api/articles${qs(params)}`),
  article: (id) => request(`/api/articles/${id}`),
  createArticle: (body) => request('/api/articles', { method: 'POST', body: JSON.stringify(body) }),
  saveArticle: (id, body) =>
    request(`/api/articles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  setArticleStatus: (id, body) =>
    request(`/api/articles/${id}/status`, { method: 'POST', body: JSON.stringify(body) }),
  trashArticle: (id) => request(`/api/articles/${id}`, { method: 'DELETE' }),
  purgeArticle: (id) => request(`/api/articles/${id}?permanent=1`, { method: 'DELETE' }),
  restoreArticle: (id) => request(`/api/articles/${id}/restore`, { method: 'POST' }),
  emptyTrash: () => request('/api/trash', { method: 'DELETE' }),
  revisions: (id) => request(`/api/articles/${id}/revisions`),
  restoreRevision: (id, revisionId) =>
    request(`/api/articles/${id}/revisions/${revisionId}/restore`, { method: 'POST' }),

  media: (params) => request(`/api/media${qs(params)}`),
  updateMedia: (id, body) =>
    request(`/api/media/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMedia: (id, permanent) =>
    request(`/api/media/${id}${permanent ? '?permanent=1' : ''}`, { method: 'DELETE' }),

  settings: () => request('/api/settings'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  addSocial: (body) => request('/api/social', { method: 'POST', body: JSON.stringify(body) }),
  updateSocial: (id, body) =>
    request(`/api/social/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSocial: (id) => request(`/api/social/${id}`, { method: 'DELETE' }),

  visuals: (world) => request(`/api/visuals${qs({ world })}`),
  generateVisuals: (body) =>
    request('/api/visuals/generate', { method: 'POST', body: JSON.stringify(body) }),
  activateVisual: (id) => request(`/api/visuals/${id}/activate`, { method: 'POST' }),
  deleteVisual: (id) => request(`/api/visuals/${id}`, { method: 'DELETE' }),

  searchStatus: () => request('/api/search/status'),
  rebuildSearch: () => request('/api/search/rebuild', { method: 'POST' }),
};

/** 上传（带进度）：直接发二进制，服务端按类型自动生成优化版本。 */
export function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'file'));
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `上传失败（${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error('上传失败：网络错误'));
    xhr.send(file);
  });
}

export const SECTIONS = [
  { key: 'origin', name: '缘起', question: '为什么', accent: '#6f9e5a' },
  { key: 'self', name: '本我', question: '我是什么', accent: '#cf7891' },
  { key: 'bloom', name: '绽放', question: '我与世界', accent: '#8a7ac8' },
  { key: 'log', name: '日志', question: '', accent: '#6a6a6a' },
];

export const STATUS_LABELS = {
  draft: '草稿',
  published: '已发布',
  scheduled: '定时发布',
};

export function sectionName(key) {
  const found = SECTIONS.find((item) => item.key === key);
  return found ? found.name : key;
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function toInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function fromInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

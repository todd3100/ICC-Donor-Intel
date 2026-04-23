// Thin fetch wrapper. Credentials: include so JWT cookie travels.
async function request(method, url, body, isForm = false) {
  const opts = {
    method,
    credentials: 'include',
    headers: isForm ? {} : { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = isForm ? body : JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, formData) => request('POST', url, formData, true),
};

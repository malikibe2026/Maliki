// Utiliti kongsi untuk host.html dan play.html
window.Kuiz = (() => {
  const SHAPES = ['▲', '◆', '●', '■'];

  // Cipta elemen DOM dengan selamat (teks pengguna tidak pernah dimasukkan sebagai HTML)
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  async function api(path, body, headers = {}) {
    const res = await fetch(path, body === undefined
      ? { headers }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Ralat berlaku');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Sambungan SSE melalui fetch supaya boleh hantar header (token tidak masuk URL).
  // Mengembalikan fungsi untuk menutup sambungan.
  function openStream(path, headers, onData, onRejected) {
    let stopped = false;
    let controller = null;

    async function run() {
      while (!stopped) {
        controller = new AbortController();
        try {
          const res = await fetch(path, { headers, signal: controller.signal, cache: 'no-store' });
          if (res.status === 403 || res.status === 404) {
            if (!stopped) onRejected(res.status);
            return;
          }
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              for (const line of chunk.split('\n')) {
                if (line.startsWith('data: ')) onData(JSON.parse(line.slice(6)));
              }
            }
          }
        } catch (err) {
          if (stopped) return;
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 2000)); // cuba semula
      }
    }

    run();
    return () => {
      stopped = true;
      if (controller) controller.abort();
    };
  }

  async function download(path, headers, filename) {
    const res = await fetch(path, { headers });
    if (!res.ok) throw new Error('Gagal muat turun fail');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { h, api, openStream, download, SHAPES };
})();

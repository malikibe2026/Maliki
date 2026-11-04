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

  async function api(path, body) {
    const res = await fetch(path, body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Ralat berlaku');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return { h, api, SHAPES };
})();

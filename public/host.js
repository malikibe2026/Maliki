(() => {
  'use strict';

  const { h, api, openStream, download, SHAPES } = window.Kuiz;
  const app = document.getElementById('app');
  const STORE_KEY = 'kuiz-host';

  let room = null;      // { code, hostToken, quizTitle }
  let state = null;     // snapshot terkini dari pelayan
  let offset = 0;       // jam pelayan - jam peranti
  let closeStream = null;
  let timerId = null;
  let timerFill = null;
  let timerText = null;

  // ---------- Komunikasi ----------
  function saveRoom(r) {
    room = r;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(r)); } catch { /* abaikan */ }
  }

  function loadRoom() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)); } catch { return null; }
  }

  function forgetRoom() {
    room = null;
    state = null;
    if (closeStream) { closeStream(); closeStream = null; }
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* abaikan */ }
    render();
  }

  function connect() {
    if (closeStream) closeStream();
    closeStream = openStream(
      `/api/rooms/${room.code}/stream`,
      { 'X-Host-Token': room.hostToken },
      (data) => {
        state = data;
        offset = state.now - Date.now();
        render();
      },
      () => {
        closeStream = null;
        showError('Bilik tidak lagi wujud atau token tidak sah. Sila cipta bilik baru.');
      },
    );
  }

  function exportCsv() {
    download(`/api/rooms/${room.code}/export`, { 'X-Host-Token': room.hostToken }, `kuiz-${room.code}.csv`)
      .catch((err) => alert(err.message));
  }

  let errorMsg = '';
  function showError(msg) {
    errorMsg = msg;
    render();
  }

  async function createRoom() {
    errorMsg = '';
    try {
      const d = await api('/api/rooms', {});
      saveRoom({ code: d.code, hostToken: d.hostToken, quizTitle: d.quizTitle });
      connect();
    } catch (err) {
      showError(err.message);
    }
  }

  async function control(action) {
    try {
      await api(`/api/rooms/${room.code}/control`, { action }, { 'X-Host-Token': room.hostToken });
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- Pemasa ----------
  function updateTimer() {
    if (!state || state.phase !== 'question' || !timerFill) return;
    const leftMs = Math.max(0, state.deadline - (Date.now() + offset));
    const pct = Math.min(100, (leftMs / (state.question.limit * 1000)) * 100);
    timerFill.style.width = `${pct}%`;
    timerText.textContent = String(Math.ceil(leftMs / 1000));
  }

  // ---------- Skrin ----------
  function topBar(extra) {
    return h('header', { class: 'top' },
      h('div', {}, h('strong', {}, state ? state.quizTitle : room.quizTitle), h('span', { class: 'muted' }, state && state.qNumber > 0 ? `  ·  Soalan ${state.qNumber} / ${state.total}` : '')),
      extra);
  }

  function startScreen() {
    return h('section', { class: 'stack center', style: 'margin:auto;' },
      h('h1', {}, 'Kuiz Live'),
      h('p', { class: 'muted' }, 'Cipta bilik baru, kemudian minta peserta masukkan kod di telefon mereka.'),
      h('button', { class: 'btn-primary', onclick: createRoom }, 'Cipta bilik kuiz'),
      h('p', { class: 'error' }, errorMsg));
  }

  // Kanvas QR dilukis selepas skrin dipasang (lihat render)
  let pendingQr = null;

  function lobbyScreen() {
    const players = state.players || [];
    const joinUrl = `${location.origin}/play.html?code=${room.code}`;
    const canvas = h('canvas', { class: 'qr-canvas', width: 220, height: 220 });
    pendingQr = { canvas, text: joinUrl };
    return [
      topBar(null),
      h('section', { class: 'layout no-side', style: 'align-content:center;' },
        h('div', { class: 'stack' },
          h('p', { class: 'center muted' }, 'Imbas QR ini dengan telefon, atau pergi ke alamat di bawah:'),
          h('div', { class: 'qr-wrap' }, canvas),
          h('p', { class: 'join-url' }, `${location.origin}/play.html`),
          h('p', { class: 'center muted' }, 'Masukkan kod:'),
          h('div', { class: 'code' }, room.code),
        ),
        h('div', { class: 'card', style: 'margin-top:24px;' },
          h('h2', { class: 'center' }, `Peserta (${players.length})`),
          h('div', { class: 'players' },
            players.length
              ? players.map((p) => h('span', { class: 'chip' }, p.name))
              : h('p', { class: 'muted center' }, 'Menunggu peserta menyertai...')))),
      h('footer', { class: 'controls' },
        h('span', { class: 'muted' }, `${state.total} soalan`),
        h('button', { class: 'btn-primary', disabled: players.length === 0, onclick: () => control('start') }, 'Mula kuiz')),
    ];
  }

  function questionScreen() {
    const q = state.question;
    const reveal = state.phase === 'reveal';
    const isLast = state.qNumber >= state.total;

    timerFill = null;
    timerText = null;

    const options = h('div', { class: 'options' },
      q.options.map((text, i) => {
        let cls = `opt opt-${i}`;
        if (reveal) cls += i === state.correct ? ' correct' : ' dim';
        return h('div', { class: cls },
          h('span', { class: 'shape' }, SHAPES[i]),
          h('span', { class: 'opt-text' }, text),
          reveal ? h('span', { class: 'count' }, String(state.counts[i])) : null);
      }));

    let timerBar = null;
    if (!reveal) {
      timerFill = h('div', { class: 'bar-fill' });
      timerText = h('strong', {}, '');
      timerBar = h('div', { class: 'row' }, h('div', { class: 'bar', style: 'flex:1;' }, timerFill), timerText);
    }

    const board = reveal ? leaderboard() : null;

    const controls = reveal
      ? [
        h('button', { class: 'btn-secondary btn-small', onclick: () => control('end') }, 'Tamatkan kuiz'),
        h('button', { class: 'btn-primary', onclick: () => control('next') },
          isLast ? 'Lihat keputusan akhir' : 'Soalan seterusnya'),
      ]
      : [
        h('span', { class: 'muted' }, `Dijawab: ${state.answered} / ${state.playerCount}`),
        h('div', { class: 'row' },
          h('button', { class: 'btn-secondary btn-small', onclick: () => control('end') }, 'Tamatkan kuiz'),
          h('button', { class: 'btn-primary', onclick: () => control('reveal') }, 'Dedahkan jawapan')),
      ];

    return [
      topBar(null),
      timerBar,
      h('section', { class: board ? 'layout' : 'layout no-side' },
        h('div', { class: 'stack' },
          h('div', { class: 'question-text' }, q.text),
          options),
        board),
      h('footer', { class: 'controls' }, ...controls),
    ];
  }

  function leaderboard() {
    const top = (state.ranking || []).slice(0, 5);
    return h('aside', { class: 'card' },
      h('h2', { style: 'margin-bottom:8px;' }, 'Ranking'),
      top.length
        ? top.map((p, i) => h('div', { class: 'leader-row' },
          h('span', {}, `${i + 1}. ${p.name}`),
          h('strong', {}, String(p.score))))
        : h('p', { class: 'muted' }, 'Tiada peserta.'));
  }

  function finalScreen() {
    const r = state.ranking || [];
    const top3 = r.slice(0, 3);
    const order = [top3[1], top3[0], top3[2]]; // 2 - 1 - 3
    const places = [2, 1, 3];
    return [
      topBar(null),
      h('section', { class: 'stack', style: 'align-items:center;' },
        h('h1', { class: 'center' }, 'Keputusan Akhir'),
        h('div', { class: 'podium' },
          order.map((p, i) => p ? h('div', { class: `podium-step p${places[i]}`, style: `padding-top:${places[i] === 1 ? 40 : 16}px;` },
            h('div', { class: 'place' }, String(places[i])),
            h('div', { style: 'font-weight:700;font-size:1.2rem;' }, p.name),
            h('div', {}, `${p.score} mata`)) : null)),
        h('div', { class: 'card', style: 'width:100%;max-width:640px;' },
          r.length
            ? r.map((p, i) => h('div', { class: 'leader-row' },
              h('span', {}, `${i + 1}. ${p.name}`),
              h('strong', {}, String(p.score))))
            : h('p', { class: 'muted center' }, 'Tiada peserta.'))),
      h('footer', { class: 'controls' },
        h('button', { class: 'btn-secondary', onclick: exportCsv }, 'Muat turun keputusan (CSV)'),
        h('button', { class: 'btn-primary', onclick: forgetRoom }, 'Cipta bilik baru')),
    ];
  }

  function errorScreen() {
    return h('section', { class: 'stack center', style: 'margin:auto;' },
      h('p', { class: 'error' }, errorMsg),
      h('button', { class: 'btn-primary', onclick: () => { errorMsg = ''; forgetRoom(); } }, 'Cipta bilik baru'));
  }

  function render() {
    clearInterval(timerId);
    timerId = null;

    let nodes;
    if (errorMsg && !state) nodes = [errorScreen()];
    else if (!room) nodes = [startScreen()];
    else if (!state) nodes = [h('p', { class: 'muted center', style: 'margin:auto;' }, 'Menyambung ke bilik...')];
    else if (state.phase === 'lobby') nodes = lobbyScreen();
    else if (state.phase === 'question' || state.phase === 'reveal') nodes = questionScreen();
    else nodes = finalScreen();

    app.replaceChildren(...[nodes].flat().filter(Boolean));

    if (pendingQr) {
      const { canvas, text } = pendingQr;
      pendingQr = null;
      if (window.QRCode) {
        window.QRCode.toCanvas(canvas, text, {
          width: 220,
          margin: 1,
          color: { dark: '#1d0b45', light: '#ffffff' },
        }, (err) => { if (err) canvas.replaceWith(h('p', { class: 'muted center' }, text)); });
      } else {
        canvas.replaceWith(h('p', { class: 'muted center' }, text));
      }
    }

    if (state && state.phase === 'question') {
      updateTimer();
      timerId = setInterval(updateTimer, 200);
    }
  }

  // ---------- Mula ----------
  const saved = loadRoom();
  if (saved && saved.code && saved.hostToken) {
    saveRoom(saved);
    connect();
  }
  render();
})();

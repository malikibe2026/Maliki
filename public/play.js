(() => {
  'use strict';

  const { h, api, SHAPES } = window.Kuiz;
  const app = document.getElementById('app');
  const STORE_KEY = 'kuiz-player';

  const params = new URLSearchParams(location.search);
  let code = (params.get('code') || '').replace(/\D/g, '').slice(0, 6);

  let me = null;        // { code, playerId, name }
  let state = null;     // snapshot terkini
  let offset = 0;
  let es = null;
  let timerId = null;
  let timerFill = null;
  let timerText = null;
  let chosen = null;    // { qNumber, choice } - pilihan yang baru dihantar
  let message = '';     // ralat / mesej untuk pengguna

  // ---------- Simpanan tempatan (sekadar untuk sambung semula) ----------
  function loadMe() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
  }
  function saveMe(data) {
    me = data;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* abaikan */ }
  }
  function clearMe() {
    me = null;
    try { localStorage.removeItem(STORE_KEY); } catch { /* abaikan */ }
  }

  // ---------- Sambungan ----------
  function connect() {
    if (es) es.close();
    const url = `/api/rooms/${me.code}/stream?audience=player&playerId=${encodeURIComponent(me.playerId)}`;
    es = new EventSource(url);
    es.onmessage = (e) => {
      state = JSON.parse(e.data);
      offset = state.now - Date.now();
      render();
    };
    es.onerror = () => {
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        clearMe();
        state = null;
        message = 'Sesi tamat atau bilik tidak lagi wujud. Sila sertai semula.';
        render();
      }
    };
  }

  async function join(e) {
    e.preventDefault();
    message = '';
    const form = e.target;
    const inputCode = form.querySelector('[name="code"]').value.replace(/\D/g, '');
    const name = form.querySelector('[name="name"]').value.trim();
    if (inputCode.length !== 6) { message = 'Kod bilik mesti 6 digit.'; return render(); }
    if (!name) { message = 'Sila masukkan nama anda.'; return render(); }

    try {
      const d = await api(`/api/rooms/${inputCode}/join`, { name });
      code = inputCode;
      saveMe({ code: inputCode, playerId: d.playerId, name: d.name });
      state = null;
      connect();
      render();
    } catch (err) {
      message = err.message;
      render();
    }
  }

  async function answer(choice) {
    if (chosen && chosen.qNumber === state.qNumber) return;
    chosen = { qNumber: state.qNumber, choice };
    render();
    try {
      await api(`/api/rooms/${me.code}/answer`, { playerId: me.playerId, choice });
    } catch (err) {
      chosen = null;
      message = err.message;
      render();
    }
  }

  // ---------- Pemasa ----------
  function updateTimer() {
    if (!state || state.phase !== 'question' || !timerFill) return;
    const leftMs = Math.max(0, state.deadline - (Date.now() + offset));
    timerFill.style.width = `${Math.min(100, (leftMs / (state.question.limit * 1000)) * 100)}%`;
    timerText.textContent = String(Math.ceil(leftMs / 1000));
  }

  // ---------- Skrin ----------
  function joinScreen() {
    return h('section', { class: 'stack', style: 'margin:auto;width:100%;' },
      h('h1', { class: 'center' }, 'Sertai Kuiz'),
      h('form', { class: 'join-form', onsubmit: join },
        h('input', { name: 'code', placeholder: 'Kod bilik (6 digit)', inputmode: 'numeric', maxlength: '6', autocomplete: 'off', value: code }),
        h('input', { name: 'name', placeholder: 'Nama anda', maxlength: '20', autocomplete: 'nickname', required: true }),
        h('button', { class: 'btn-primary', type: 'submit' }, 'Sertai'),
        h('p', { class: 'error' }, message)));
  }

  function waitingScreen() {
    const players = state.players || [];
    return h('section', { class: 'stack center', style: 'margin:auto;width:100%;' },
      h('h1', {}, `Hai, ${me.name}!`),
      h('p', { class: 'muted' }, 'Anda berjaya masuk. Tunggu host memulakan kuiz.'),
      h('div', { class: 'card' },
        h('p', { class: 'muted' }, `Peserta dalam bilik (${players.length})`),
        h('div', {}, players.map((p) => h('span', { class: 'chip' }, p.name)))));
  }

  function questionScreen() {
    const q = state.question;
    const you = state.you || {};
    const alreadyAnswered = you.answered || (chosen && chosen.qNumber === state.qNumber);
    timerFill = null;
    timerText = null;

    if (alreadyAnswered) {
      const picked = chosen && chosen.qNumber === state.qNumber ? chosen.choice : null;
      return h('section', { class: 'stack center', style: 'margin:auto;width:100%;' },
        h('div', { class: 'card' },
          h('h2', {}, 'Jawapan diterima!'),
          h('p', { class: 'muted' }, 'Tunggu soalan seterusnya...'),
          picked !== null ? h('p', { style: 'margin-top:12px;font-size:1.4rem;' }, SHAPES[picked] + '  ' + q.options[picked]) : null));
    }

    timerFill = h('div', { class: 'bar-fill' });
    timerText = h('div', { class: 'timer-num' }, '');
    return [
      h('div', { class: 'muted center' }, `Soalan ${state.qNumber} / ${state.total}`),
      h('div', { class: 'bar' }, timerFill),
      timerText,
      h('div', { class: 'q-text' }, q.text),
      h('div', { class: 'options' },
        q.options.map((text, i) => h('button', {
          class: `opt opt-${i}`,
          onclick: () => answer(i),
        }, h('span', { class: 'shape' }, SHAPES[i]), h('span', { class: 'opt-text' }, text)))),
    ];
  }

  function revealScreen() {
    const q = state.question;
    const you = state.you || {};
    const r = you.result;
    let resultBox;
    if (!r) {
      resultBox = h('div', { class: 'result none' }, 'Masa tamat', h('small', {}, 'Anda tidak menjawab.'));
    } else if (r.correct) {
      resultBox = h('div', { class: 'result ok' }, `Betul! +${r.points}`, h('small', {}, `Jumlah mata: ${you.score}`));
    } else {
      resultBox = h('div', { class: 'result bad' }, 'Salah', h('small', {}, `Jumlah mata: ${you.score}`));
    }
    return [
      h('div', { class: 'muted center' }, `Soalan ${state.qNumber} / ${state.total}`),
      resultBox,
      h('div', { class: 'q-text', style: 'font-size:1.05rem;' }, q.text),
      h('div', { class: 'options list' },
        q.options.map((text, i) => {
          let cls = `opt opt-${i}`;
          cls += i === state.correct ? ' correct' : ' dim';
          return h('div', { class: cls }, h('span', { class: 'shape' }, SHAPES[i]), h('span', { class: 'opt-text' }, text));
        })),
      h('p', { class: 'muted center' }, 'Tunggu host meneruskan soalan seterusnya...'),
    ];
  }

  function finalScreen() {
    const you = state.you || {};
    const top3 = (state.ranking || []).slice(0, 3);
    return h('section', { class: 'stack center', style: 'margin:auto;width:100%;' },
      h('h1', {}, 'Kuiz tamat!'),
      h('div', { class: 'card' },
        h('p', { class: 'muted' }, 'Kedudukan anda'),
        h('div', { style: 'font-size:3rem;font-weight:800;' }, you.rank ? `#${you.rank}` : '-'),
        h('p', {}, `${you.score ?? 0} mata`)),
      h('div', { class: 'card', style: 'text-align:left;' },
        h('h2', { style: 'margin-bottom:8px;' }, 'Tiga teratas'),
        top3.map((p, i) => h('div', { class: 'leader-row', style: 'display:flex;justify-content:space-between;padding:8px 0;' },
          h('span', {}, `${i + 1}. ${p.name}`),
          h('strong', {}, String(p.score))))));
  }

  function waitingForRoomScreen() {
    return h('section', { class: 'stack center', style: 'margin:auto;' },
      h('p', { class: 'muted' }, 'Menyambung ke bilik...'));
  }

  function render() {
    clearInterval(timerId);
    timerId = null;

    let nodes;
    if (!me) nodes = joinScreen();
    else if (!state) nodes = waitingForRoomScreen();
    else if (state.phase === 'lobby') nodes = waitingScreen();
    else if (state.phase === 'question') nodes = questionScreen();
    else if (state.phase === 'reveal') nodes = revealScreen();
    else nodes = finalScreen();

    app.replaceChildren(...[nodes].flat().filter(Boolean));

    if (state && state.phase === 'question') {
      updateTimer();
      timerId = setInterval(updateTimer, 200);
    }
  }

  // ---------- Mula ----------
  const stored = loadMe();
  if (stored && stored.code && stored.playerId && (!code || stored.code === code)) {
    saveMe(stored);
    code = stored.code;
    connect();
  }
  render();
})();

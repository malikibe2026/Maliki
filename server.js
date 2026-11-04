'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const QUIZ = JSON.parse(fs.readFileSync(path.join(__dirname, 'quiz.json'), 'utf8'));
const MAX_POINTS = 1000;
const ROOM_TTL_MS = 4 * 60 * 60 * 1000; // bilik tanpa aktiviti dipadam selepas 4 jam
const MAX_BODY_BYTES = 16 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- Pengesahan kuiz ----------
function validateQuiz(quiz) {
  if (!quiz.questions || !quiz.questions.length) throw new Error('quiz.json tiada soalan');
  quiz.questions.forEach((q, i) => {
    if (!q.text || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
      throw new Error(`Soalan ${i + 1} tidak sah (perlu 2-4 pilihan)`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
      throw new Error(`Soalan ${i + 1}: "answer" mesti indeks pilihan yang betul`);
    }
    if (!Number.isInteger(q.limit) || q.limit < 5) {
      throw new Error(`Soalan ${i + 1}: "limit" (saat) mesti sekurang-kurangnya 5`);
    }
  });
}
validateQuiz(QUIZ);

// ---------- Utiliti ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const rid = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Permintaan terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'JSON tidak sah'));
      }
    });
    req.on('error', reject);
  });
}

function cleanName(raw) {
  const name = String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 20);
  if (!name) throw new HttpError(400, 'Sila masukkan nama');
  return name;
}

// ---------- Bilik ----------
const rooms = new Map();

function createRoom() {
  let code;
  do {
    code = String(crypto.randomInt(100000, 1000000));
  } while (rooms.has(code));
  const room = {
    code,
    phase: 'lobby', // lobby | question | reveal | final
    hostToken: rid(16),
    players: new Map(), // id -> { id, name, score, last }
    qIndex: -1,
    qStart: 0,
    deadline: 0,
    answers: new Map(), // playerId -> { choice, correct, points }
    timer: null,
    subs: new Set(),
    lastActive: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  const room = rooms.get(code);
  if (!room) throw new HttpError(404, 'Bilik tidak ditemui');
  room.lastActive = Date.now();
  return room;
}

function requireHost(room, token) {
  if (!safeEqual(token, room.hostToken)) throw new HttpError(403, 'Token host tidak sah');
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score }));
}

function ranking(room) {
  return publicPlayers(room).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// Paparan ikut penonton: pemain tidak nampak jawapan betul sehingga reveal.
function snapshot(room, sub) {
  const q = room.qIndex >= 0 ? QUIZ.questions[room.qIndex] : null;
  const s = {
    now: Date.now(),
    phase: room.phase,
    code: room.code,
    quizTitle: QUIZ.title,
    total: QUIZ.questions.length,
    qNumber: room.qIndex + 1,
    playerCount: room.players.size,
  };

  if (room.phase === 'lobby') s.players = publicPlayers(room);

  if (q && (room.phase === 'question' || room.phase === 'reveal')) {
    s.question = { text: q.text, options: q.options, limit: q.limit };
    s.deadline = room.deadline;
    s.answered = room.answers.size;
  }

  if (q && room.phase === 'reveal') {
    s.correct = q.answer;
    s.counts = q.options.map((_, i) => [...room.answers.values()].filter((a) => a.choice === i).length);
  }

  if (room.phase === 'reveal' || room.phase === 'final') {
    s.ranking = ranking(room);
  }

  if (sub.audience === 'player') {
    const player = room.players.get(sub.playerId);
    if (player) {
      const rank = room.phase === 'reveal' || room.phase === 'final'
        ? ranking(room).findIndex((p) => p.id === player.id) + 1
        : null;
      s.you = {
        id: player.id,
        name: player.name,
        score: player.score,
        answered: room.answers.has(player.id),
        result: room.phase === 'reveal' ? player.last : null,
        rank,
      };
    }
  }
  return s;
}

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room) {
  for (const sub of room.subs) sendEvent(sub.res, snapshot(room, sub));
}

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function startQuestion(room, index) {
  clearTimer(room);
  const q = QUIZ.questions[index];
  room.phase = 'question';
  room.qIndex = index;
  room.answers = new Map();
  room.qStart = Date.now();
  room.deadline = room.qStart + q.limit * 1000;
  for (const p of room.players.values()) p.last = null;
  room.timer = setTimeout(() => reveal(room), q.limit * 1000);
  broadcast(room);
}

function reveal(room) {
  if (room.phase !== 'question') return;
  clearTimer(room);
  room.phase = 'reveal';
  broadcast(room);
}

function finish(room) {
  clearTimer(room);
  room.phase = 'final';
  broadcast(room);
}

function join(room, body) {
  if (body.playerId && room.players.has(body.playerId)) {
    return room.players.get(body.playerId); // sambung semula
  }
  if (room.phase !== 'lobby') {
    throw new HttpError(409, 'Kuiz sudah bermula. Anda tidak boleh menyertai sekarang.');
  }
  const player = { id: rid(8), name: cleanName(body.name), score: 0, last: null };
  room.players.set(player.id, player);
  broadcast(room);
  return player;
}

function answer(room, playerId, choice) {
  if (room.phase !== 'question') throw new HttpError(409, 'Tiada soalan dibuka sekarang');
  const player = room.players.get(playerId);
  if (!player) throw new HttpError(403, 'Peserta tidak sah');
  if (room.answers.has(playerId)) return; // abaikan hantaran berganda

  const q = QUIZ.questions[room.qIndex];
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) {
    throw new HttpError(400, 'Pilihan tidak sah');
  }
  const now = Date.now();
  if (now > room.deadline + 500) throw new HttpError(409, 'Masa untuk soalan ini sudah tamat');

  // Betul: 1000 mata jika jawab serta-merta, turun ke 500 mata pada saat akhir.
  const elapsed = Math.min(now - room.qStart, q.limit * 1000);
  const correct = choice === q.answer;
  const points = correct ? Math.round(MAX_POINTS * (1 - elapsed / (q.limit * 2000))) : 0;

  player.score += points;
  const record = { choice, correct, points };
  player.last = record;
  room.answers.set(playerId, record);

  if (room.answers.size >= room.players.size) reveal(room);
  else broadcast(room);
}

function control(room, action) {
  switch (action) {
    case 'start':
      if (room.phase !== 'lobby') throw new HttpError(409, 'Kuiz sudah bermula');
      if (room.players.size === 0) throw new HttpError(409, 'Tiada peserta lagi');
      return startQuestion(room, 0);
    case 'reveal':
      if (room.phase !== 'question') throw new HttpError(409, 'Tiada soalan dibuka');
      return reveal(room);
    case 'next':
      if (room.phase !== 'reveal') throw new HttpError(409, 'Dedahkan jawapan dahulu');
      if (room.qIndex + 1 < QUIZ.questions.length) return startQuestion(room, room.qIndex + 1);
      return finish(room);
    case 'end':
      if (room.phase === 'final') throw new HttpError(409, 'Kuiz sudah tamat');
      return finish(room);
    default:
      throw new HttpError(400, 'Tindakan tidak sah');
  }
}

// ---------- Laluan API ----------
function openStream(room, req, res, url) {
  const sub = { audience: 'player', playerId: null, res };
  if (url.searchParams.get('audience') === 'host') {
    requireHost(room, url.searchParams.get('token'));
    sub.audience = 'host';
  } else {
    const playerId = url.searchParams.get('playerId');
    if (!room.players.has(playerId)) throw new HttpError(403, 'Peserta tidak sah');
    sub.playerId = playerId;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': sambung\n\n');
  room.subs.add(sub);
  sendEvent(res, snapshot(room, sub));

  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    room.subs.delete(sub);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', code, action]

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const room = createRoom();
    return sendJson(res, 201, {
      code: room.code,
      hostToken: room.hostToken,
      quizTitle: QUIZ.title,
      total: QUIZ.questions.length,
    });
  }

  if (parts[0] !== 'api' || parts[1] !== 'rooms' || !parts[2]) {
    throw new HttpError(404, 'Tidak ditemui');
  }

  const room = getRoom(parts[2]);
  const action = parts[3];

  if (req.method === 'GET' && action === 'stream') return openStream(room, req, res, url);
  if (req.method !== 'POST') throw new HttpError(405, 'Kaedah tidak dibenarkan');

  const body = await readBody(req);

  if (action === 'join') {
    const player = join(room, body);
    return sendJson(res, 200, { playerId: player.id, name: player.name });
  }
  if (action === 'answer') {
    answer(room, body.playerId, body.choice);
    return sendJson(res, 200, { ok: true });
  }
  if (action === 'control') {
    requireHost(room, body.token);
    control(room, body.action);
    return sendJson(res, 200, { ok: true });
  }
  throw new HttpError(404, 'Tidak ditemui');
}

// ---------- Fail statik ----------
function serveStatic(pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    throw new HttpError(400, 'Laluan tidak sah');
  }
  const file = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Dilarang');

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Tidak ditemui');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Pelayan ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'Kaedah tidak dibenarkan');
    }
    return serveStatic(url.pathname, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.end();
    sendJson(res, status, { error: err instanceof HttpError ? err.message : 'Ralat pelayan' });
  }
});

// Bersihkan bilik lama yang tiada penonton
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.subs.size === 0 && now - room.lastActive > ROOM_TTL_MS) {
      clearTimer(room);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kuiz Live berjalan di port ${PORT}`);
  console.log(`  Host (komputer):  http://localhost:${PORT}/host.html`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  Peserta (telefon): http://${iface.address}:${PORT}/play.html`);
      }
    }
  }
});

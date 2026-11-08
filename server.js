'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
const QUIZ = JSON.parse(fs.readFileSync(path.join(__dirname, 'quiz.json'), 'utf8'));
const MAX_POINTS = 1000;
const ROOM_TTL_MS = 4 * 60 * 60 * 1000; // bilik tanpa aktiviti dipadam selepas 4 jam
const MAX_BODY_BYTES = 16 * 1024;
const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};
// Had untuk elak banjir bilik, peserta palsu dan sambungan berlebihan (0 = tiada had)
const MAX_ROOMS = envInt('MAX_ROOMS', 50);
const MAX_ROOMS_PER_IP = envInt('MAX_ROOMS_PER_IP', 5);
const MAX_PLAYERS = envInt('MAX_PLAYERS', 100);
const MAX_PLAYERS_PER_IP = envInt('MAX_PLAYERS_PER_IP', 0);
const MAX_STREAMS_PER_VIEWER = 3;

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
  if (!quiz.title || !quiz.questions || !quiz.questions.length) throw new Error('quiz.json tiada tajuk atau soalan');
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

function newRoomState(code, hostToken, creatorIp = null) {
  return {
    code,
    creatorIp,
    phase: 'lobby', // lobby | question | reveal | final
    hostToken,
    players: new Map(), // id -> { id, name, score, last, ip } (id ialah rahsia peserta)
    qIndex: -1,
    qStart: 0,
    deadline: 0,
    answers: new Map(), // peserta -> rekod jawapan untuk soalan semasa
    responses: QUIZ.questions.map(() => null), // indeks soalan -> Map jawapan
    timer: null,
    subs: new Set(),
    lastActive: Date.now(),
  };
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function deleteRoom(room) {
  clearTimer(room);
  for (const sub of room.subs) sub.res.end();
  rooms.delete(room.code);
}

function createRoom(ip) {
  if (MAX_ROOMS_PER_IP) {
    const own = [...rooms.values()]
      .filter((r) => r.creatorIp === ip)
      .sort((a, b) => a.lastActive - b.lastActive);
    if (own.length >= MAX_ROOMS_PER_IP) {
      // Buang bilik lama milik peranti yang sama jika tiada skrin yang sedang terbuka
      const idle = own.find((r) => r.subs.size === 0);
      if (!idle) throw new HttpError(429, 'Terlalu banyak bilik aktif dari peranti ini');
      deleteRoom(idle);
    }
  }
  if (MAX_ROOMS && rooms.size >= MAX_ROOMS) {
    throw new HttpError(503, 'Pelayan penuh. Cuba lagi kemudian.');
  }
  let code;
  do {
    code = String(crypto.randomInt(100000, 1000000));
  } while (rooms.has(code));
  const room = newRoomState(code, rid(16), ip);
  rooms.set(code, room);
  persist();
  return room;
}

function getRoom(code) {
  const room = rooms.get(code);
  if (!room) throw new HttpError(404, 'Bilik tidak ditemui');
  room.lastActive = Date.now();
  return room;
}

function requireHost(room, req) {
  if (!safeEqual(req.headers['x-host-token'], room.hostToken)) {
    throw new HttpError(403, 'Token host tidak sah');
  }
}

function requirePlayer(room, playerId) {
  if (!playerId || !room.players.has(playerId)) throw new HttpError(403, 'Peserta tidak sah');
  return room.players.get(playerId);
}

// ID peserta ialah kelayakan rahsia: jangan sekali-kali hantar ID peserta lain kepada klien.
const publicView = (p) => ({ name: p.name, score: p.score });

function publicPlayers(room) {
  return [...room.players.values()].map(publicView);
}

function sortedPlayers(room) {
  return [...room.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function ranking(room) {
  return sortedPlayers(room).map(publicView);
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
        ? sortedPlayers(room).findIndex((p) => p.id === player.id) + 1
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
  persist();
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
  room.responses[index] = room.answers;
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

function join(room, body, ip) {
  if (body.playerId && room.players.has(body.playerId)) {
    return room.players.get(body.playerId); // sambung semula
  }
  if (room.phase !== 'lobby') {
    throw new HttpError(409, 'Kuiz sudah bermula. Anda tidak boleh menyertai sekarang.');
  }
  if (MAX_PLAYERS && room.players.size >= MAX_PLAYERS) {
    throw new HttpError(409, 'Bilik sudah penuh');
  }
  if (MAX_PLAYERS_PER_IP) {
    let fromIp = 0;
    for (const p of room.players.values()) if (p.ip === ip) fromIp++;
    if (fromIp >= MAX_PLAYERS_PER_IP) throw new HttpError(429, 'Terlalu banyak peserta dari peranti ini');
  }
  const player = { id: rid(16), name: cleanName(body.name), score: 0, last: null, ip };
  room.players.set(player.id, player);
  broadcast(room);
  return player;
}

function answer(room, playerId, choice) {
  if (room.phase !== 'question') throw new HttpError(409, 'Tiada soalan dibuka sekarang');
  const player = requirePlayer(room, playerId);
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
  const record = { choice, correct, points, ms: elapsed };
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

// ---------- Simpanan kekal (fail JSON) ----------
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeState, 200);
}

function writeState() {
  const data = [...rooms.values()].map((r) => ({
    code: r.code,
    creatorIp: r.creatorIp,
    phase: r.phase,
    hostToken: r.hostToken,
    qIndex: r.qIndex,
    qStart: r.qStart,
    deadline: r.deadline,
    lastActive: r.lastActive,
    players: [...r.players.values()],
    responses: r.responses.map((m) => (m ? [...m.entries()] : null)),
  }));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Gagal simpan keadaan:', err.message);
  }
}

function loadState() {
  if (!fs.existsSync(DATA_FILE)) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Gagal baca fail keadaan, bermula dengan bilik kosong:', err.message);
    return;
  }
  const now = Date.now();
  for (const d of data) {
    if (now - d.lastActive > ROOM_TTL_MS) continue;
    const room = newRoomState(d.code, d.hostToken, d.creatorIp || null);
    room.qIndex = d.qIndex;
    room.qStart = d.qStart;
    room.deadline = d.deadline;
    room.lastActive = d.lastActive;
    for (const p of d.players) room.players.set(p.id, p);
    room.responses = QUIZ.questions.map((_, i) => (d.responses[i] ? new Map(d.responses[i]) : null));
    // Pemasa tidak boleh disambung semula selepas restart: soalan yang sedang dibuka didedahkan.
    room.phase = d.phase === 'question' ? 'reveal' : d.phase;
    room.answers = room.qIndex >= 0 ? room.responses[room.qIndex] || new Map() : new Map();
    rooms.set(room.code, room);
  }
  console.log(`Dipulihkan ${rooms.size} bilik dari ${DATA_FILE}`);
}

// ---------- Eksport CSV ----------
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // elak formula Excel
  return `"${s.replace(/"/g, '""')}"`;
}

function buildCsv(room) {
  const header = ['Kedudukan', 'Nama', 'Jumlah mata'];
  QUIZ.questions.forEach((_, i) => header.push(`S${i + 1} jawapan`, `S${i + 1} mata`));
  const rows = [header.map(csvCell).join(',')];

  sortedPlayers(room).forEach((p, idx) => {
    const cells = [idx + 1, p.name, p.score];
    QUIZ.questions.forEach((q, i) => {
      const rec = room.responses[i] ? room.responses[i].get(p.id) : null;
      if (!rec) cells.push('Tiada jawapan', 0);
      else cells.push(`${q.options[rec.choice]}${rec.correct ? ' (betul)' : ' (salah)'}`, rec.points);
    });
    rows.push(cells.map(csvCell).join(','));
  });
  return '﻿' + rows.join('\r\n') + '\r\n'; // BOM supaya Excel baca UTF-8 dengan betul
}

// ---------- Laluan API ----------
function openStream(room, req, res) {
  const sub = { audience: 'player', playerId: null, res };
  if (req.headers['x-host-token']) {
    requireHost(room, req);
    sub.audience = 'host';
  } else {
    requirePlayer(room, req.headers['x-player-id']);
    sub.playerId = req.headers['x-player-id'];
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': sambung\n\n');
  // Had sambungan serentak bagi setiap host/peserta: tutup yang paling lama
  const same = [...room.subs].filter((s) => s.audience === sub.audience && s.playerId === sub.playerId);
  while (same.length >= MAX_STREAMS_PER_VIEWER) {
    const old = same.shift();
    room.subs.delete(old);
    old.res.end();
  }
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
    const room = createRoom(clientIp(req));
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

  if (req.method === 'GET' && action === 'stream') return openStream(room, req, res);

  if (req.method === 'GET' && action === 'export') {
    requireHost(room, req);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kuiz-${room.code}.csv"`,
      'Cache-Control': 'no-store',
    });
    return res.end(buildCsv(room));
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Kaedah tidak dibenarkan');

  const body = await readBody(req);

  if (action === 'join') {
    const player = join(room, body, clientIp(req));
    return sendJson(res, 200, { playerId: player.id, name: player.name });
  }
  if (action === 'answer') {
    answer(room, req.headers['x-player-id'], body.choice);
    return sendJson(res, 200, { ok: true });
  }
  if (action === 'control') {
    requireHost(room, req);
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
  let changed = false;
  for (const room of rooms.values()) {
    if (room.subs.size === 0 && now - room.lastActive > ROOM_TTL_MS) {
      deleteRoom(room);
      changed = true;
    }
  }
  if (changed) persist();
}, 10 * 60 * 1000).unref();

// Simpan segera apabila pelayan ditutup
function shutdown() {
  clearTimeout(saveTimer);
  writeState();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
  loadState();
  server.listen(PORT, HOST, () => {
    console.log(`Kuiz Live berjalan di port ${PORT}`);
    console.log(`  Host (komputer):   http://localhost:${PORT}/host.html`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const iface of list || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`  Peserta (telefon): http://${iface.address}:${PORT}/play.html`);
        }
      }
    }
  });
}

module.exports = { server, rooms, loadState, writeState };

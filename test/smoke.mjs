// Ujian integrasi: 30 peserta, kuiz penuh, eksport CSV, restart pelayan, privasi ID dan had.
// Jalankan dengan: npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kuiz-test-'));
const PLAYERS = 30;

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${msg}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(extraEnv = {}, dataDir = DATA_DIR) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'server.js')], {
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => {
      out += d;
      if (out.includes('berjalan')) resolve(child);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => reject(new Error(`Pelayan berhenti (${code}): ${out}`)));
  });
}

const api = async (method, p, { body, headers = {} } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

// Dengar SSE dan simpan snapshot terakhir
function watch(p, headers) {
  const w = { last: null, count: 0, stop: null, ended: false };
  const ac = new AbortController();
  w.stop = () => ac.abort();
  (async () => {
    try {
      const res = await fetch(BASE + p, { headers, signal: ac.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) { w.last = JSON.parse(line.slice(6)); w.count++; }
        }
      }
    } catch { /* dihentikan */ }
    w.ended = true;
  })();
  return w;
}

async function waitFor(fn, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(20);
  }
  return false;
}

let server = await startServer();
const quiz = JSON.parse(fs.readFileSync(path.join(root, 'quiz.json'), 'utf8'));
const TOTAL = quiz.questions.length;

// 1. Cipta bilik dan 30 peserta
const created = await api('POST', '/api/rooms');
check(created.status === 201, 'cipta bilik');
const { code, hostToken } = created.data;
const hostHeaders = { 'X-Host-Token': hostToken };

const players = [];
for (let i = 0; i < PLAYERS; i++) {
  const j = await api('POST', `/api/rooms/${code}/join`, { body: { name: `Peserta ${i + 1}` } });
  players.push({ id: j.data.playerId, name: j.data.name });
}
check(players.every((p) => p.id), `${PLAYERS} peserta sertai serentak`);

const host = watch(`/api/rooms/${code}/stream`, hostHeaders);
const pWatch = watch(`/api/rooms/${code}/stream`, { 'X-Player-Id': players[0].id });
await waitFor(() => host.last && host.last.playerCount === PLAYERS);
check(host.last.players.length === PLAYERS, 'host nampak semua peserta di lobi');
check(!('correct' in pWatch.last), 'peserta tidak nampak jawapan betul');
await waitFor(() => pWatch.last && pWatch.last.playerCount === PLAYERS);
const leaksId = (snap) => players.slice(1).some((p) => JSON.stringify(snap).includes(p.id));
check(pWatch.last.players.length === PLAYERS && !leaksId(pWatch.last), 'lobi tidak dedahkan ID peserta lain');
check(pWatch.last.players.every((p) => !('id' in p)), 'senarai peserta di lobi tiada medan id');

// Stream yang berlebihan untuk peserta yang sama: yang paling lama ditutup
const extra = [1, 2, 3].map(() => watch(`/api/rooms/${code}/stream`, { 'X-Player-Id': players[1].id }));
await waitFor(() => extra.every((w) => w.last));
const fourth = watch(`/api/rooms/${code}/stream`, { 'X-Player-Id': players[1].id });
await waitFor(() => fourth.last && extra.some((w) => w.ended));
await sleep(100);
check(fourth.last && !fourth.ended && extra.filter((w) => w.ended).length === 1,
  'maksimum 3 stream serentak bagi setiap peserta (yang paling lama ditutup)');
[...extra, fourth].forEach((w) => w.stop());

// Kawalan dan sekatan token
const noTok = await api('POST', `/api/rooms/${code}/control`, { body: { action: 'start' }, headers: { 'X-Host-Token': 'salah' } });
check(noTok.status === 403, 'kawalan dengan token salah ditolak');
const badStream = await api('GET', `/api/rooms/${code}/stream`, { headers: { 'X-Host-Token': 'salah' } });
check(badStream.status === 403, 'stream host dengan token salah ditolak');

// 2. Kuiz penuh: setiap soalan, semua peserta jawab rawak -> auto dedah
await api('POST', `/api/rooms/${code}/control`, { body: { action: 'start' }, headers: hostHeaders });
let allRevealed = true;
for (let q = 0; q < TOTAL; q++) {
  const opened = await waitFor(() => host.last && host.last.phase === 'question' && host.last.qNumber === q + 1);
  if (!opened) { allRevealed = false; console.log('Soalan tidak dibuka:', q + 1); break; }
  const answers = await Promise.all(players.map((p, idx) => api('POST', `/api/rooms/${code}/answer`, {
    body: { choice: (idx + q) % quiz.questions[q].options.length },
    headers: { 'X-Player-Id': p.id },
  })));
  if (answers.some((a) => a.status !== 200)) { allRevealed = false; console.log(answers.find((a) => a.status !== 200)); break; }
  const revealed = await waitFor(() => host.last.phase === 'reveal');
  if (!revealed) { allRevealed = false; break; }
  if (q < TOTAL - 1) await api('POST', `/api/rooms/${code}/control`, { body: { action: 'next' }, headers: hostHeaders });
}
check(allRevealed, `${TOTAL} soalan dijawab oleh ${PLAYERS} peserta, auto dedah bila semua jawab`);

// Keadaan semasa sebelum restart: pastikan soalan terakhir dedah
await api('POST', `/api/rooms/${code}/control`, { body: { action: 'next' }, headers: hostHeaders });
await waitFor(() => host.last && host.last.phase === 'final');
check(host.last.phase === 'final' && host.last.ranking.length === PLAYERS, 'kuiz tamat dengan ranking 30 peserta');
const scores = host.last.ranking.map((p) => p.score);
await waitFor(() => pWatch.last && pWatch.last.phase === 'final');
check(!leaksId(host.last) && !leaksId(pWatch.last), 'ranking akhir tidak dedahkan ID peserta');
check(pWatch.last.you && pWatch.last.you.rank >= 1, 'peserta masih nampak kedudukan sendiri');
check(scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'ranking tersusun ikut mata menurun');

const csv = await api('GET', `/api/rooms/${code}/export`, { headers: hostHeaders });
const lines = String(csv.data).replace(/^﻿/, '').trim().split('\r\n');
check(csv.status === 200 && lines.length === PLAYERS + 1, `eksport CSV ada ${PLAYERS} baris peserta + header`);
const csvNoTok = await api('GET', `/api/rooms/${code}/export`);
check(csvNoTok.status === 403, 'eksport CSV tanpa token ditolak');

// 3. Restart pelayan: keadaan mesti kekal
host.stop();
pWatch.stop();
server.kill('SIGTERM');
await new Promise((r) => server.on('exit', r));
server = await startServer();

const hostAfter = watch(`/api/rooms/${code}/stream`, hostHeaders);
await waitFor(() => hostAfter.last);
check(hostAfter.last && hostAfter.last.phase === 'final' && hostAfter.last.ranking.length === PLAYERS,
  'selepas restart: fasa final dan 30 peserta dipulihkan');
const before = host.last ? host.last.ranking[0] : null;
check(before && hostAfter.last.ranking[0].score === before.score, 'mata selepas restart sama seperti sebelumnya');
hostAfter.stop();

// Peserta sambung semula dengan ID lama
const rejoin = await api('POST', `/api/rooms/${code}/join`, { body: { playerId: players[5].id } });
check(rejoin.status === 200 && rejoin.data.playerId === players[5].id, 'peserta sambung semula selepas restart');

// Bilik baru selepas restart tidak mengganggu bilik lama
const second = await api('POST', '/api/rooms');
check(second.status === 201 && second.data.code !== code, 'boleh cipta bilik baru selepas restart');

server.kill('SIGTERM');
await new Promise((r) => server.on('exit', r));

// 4. Had: peserta setiap bilik dan bilik setiap peranti
const stopServer = async () => { server.kill('SIGTERM'); await new Promise((r) => server.on('exit', r)); };
const limitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuiz-had-'));
server = await startServer({ MAX_PLAYERS: '3', MAX_ROOMS_PER_IP: '2', MAX_ROOMS: '0' }, limitDir);
const ra = await api('POST', '/api/rooms');
for (let i = 0; i < 3; i++) await api('POST', `/api/rooms/${ra.data.code}/join`, { body: { name: `P${i}` } });
const full = await api('POST', `/api/rooms/${ra.data.code}/join`, { body: { name: 'Lebih' } });
check(full.status === 409, 'bilik penuh menolak peserta ke-4 (MAX_PLAYERS=3)');

const rb = await api('POST', '/api/rooms');
const rc = await api('POST', '/api/rooms');
const gone = await api('GET', `/api/rooms/${ra.data.code}/stream`, { headers: { 'X-Host-Token': ra.data.hostToken } });
check(rc.status === 201 && gone.status === 404, 'bilik lama tanpa skrin dibuang bila had bilik setiap peranti dicapai');
const hb = watch(`/api/rooms/${rb.data.code}/stream`, { 'X-Host-Token': rb.data.hostToken });
const hc = watch(`/api/rooms/${rc.data.code}/stream`, { 'X-Host-Token': rc.data.hostToken });
await waitFor(() => hb.last && hc.last);
const rd = await api('POST', '/api/rooms');
check(rd.status === 429, 'bilik baru ditolak bila semua bilik peranti ini sedang dibuka');
hb.stop();
hc.stop();
await stopServer();

const limitDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kuiz-had-'));
server = await startServer({ MAX_ROOMS: '2', MAX_ROOMS_PER_IP: '0', MAX_PLAYERS_PER_IP: '2' }, limitDir2);
const r1 = await api('POST', '/api/rooms');
await api('POST', '/api/rooms');
const r3 = await api('POST', '/api/rooms');
check(r3.status === 503, 'pelayan menolak bilik baru bila MAX_ROOMS dicapai');
for (let i = 0; i < 2; i++) await api('POST', `/api/rooms/${r1.data.code}/join`, { body: { name: `Q${i}` } });
const ipFull = await api('POST', `/api/rooms/${r1.data.code}/join`, { body: { name: 'Q3' } });
check(ipFull.status === 429, 'had peserta setiap peranti dikuatkuasakan (MAX_PLAYERS_PER_IP=2)');
await stopServer();

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.rmSync(limitDir, { recursive: true, force: true });
fs.rmSync(limitDir2, { recursive: true, force: true });

console.log(failures ? `\n${failures} ujian gagal` : '\nSemua ujian lulus');
process.exit(failures ? 1 : 0);

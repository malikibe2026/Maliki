// Sistem Kehadiran — Cloudflare Worker + D1
// Semua masa disimpan sebagai epoch ms (UTC). Tarikh kehadiran dikira dalam waktu Malaysia (UTC+8).

const MYT = 8 * 60 * 60 * 1000;
const TEMPOH_SESI = 12 * 60 * 60 * 1000; // 12 jam
const HAD_GAGAL = 5;
const TEMPOH_KUNCI = 15 * 60 * 1000;
const PBKDF2_ULANGAN = 100000; // had maksimum workerd
const STATUS_SAH = ['hadir', 'cuti', 'mc', 'kursus', 'lain'];

class RalatApi extends Error {
  constructor(status, mesej) {
    super(mesej);
    this.status = status;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    try {
      const res = await laluan(request, env, url, ctx);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    } catch (e) {
      if (e instanceof RalatApi) return json({ ralat: e.message }, e.status);
      console.error(e);
      return json({ ralat: 'Ralat pelayan.' }, 500);
    }
  },

  // Bersihkan sesi tamat tempoh setiap hari (cron dalam wrangler.toml)
  async scheduled(event, env) {
    await env.DB.prepare('DELETE FROM sesi WHERE tamat < ?').bind(Date.now()).run();
  },
};

async function laluan(req, env, url, ctx) {
  const p = url.pathname;
  const m = req.method;

  if (m === 'POST') {
    const ct = req.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) throw new RalatApi(415, 'Format permintaan mesti JSON.');
  }

  if (p === '/api/log-masuk' && m === 'POST') return logMasuk(req, env);
  if (p === '/api/log-keluar' && m === 'POST') return logKeluar(req, env);

  const sesi = await dapatkanSesi(req, env);
  if (!sesi) throw new RalatApi(401, 'Sila log masuk.');

  if (p === '/api/saya' && m === 'GET') return saya(env, sesi);
  if (p === '/api/tukar-pin' && m === 'POST') return tukarPin(req, env, sesi);

  // Pegawai (dan penyelia yang ada akaun) — mesti tukar PIN sementara dahulu
  if (p === '/api/daftar-masuk' || p === '/api/daftar-keluar' || p === '/api/sejarah') {
    if (!sesi.pengguna) throw new RalatApi(403, 'Akaun pentadbir utama tidak merekod kehadiran.');
    if (sesi.pengguna.tukar_pin) throw new RalatApi(403, 'Sila tukar PIN sementara dahulu.');
    if (p === '/api/daftar-masuk' && m === 'POST') return daftar(req, env, sesi, 'masuk');
    if (p === '/api/daftar-keluar' && m === 'POST') return daftar(req, env, sesi, 'keluar');
    if (p === '/api/sejarah' && m === 'GET') return sejarah(env, sesi);
  }

  if (p.startsWith('/api/admin/')) {
    if (sesi.peranan !== 'penyelia') throw new RalatApi(403, 'Akses penyelia sahaja.');
    if (sesi.pengguna && sesi.pengguna.tukar_pin) throw new RalatApi(403, 'Sila tukar PIN sementara dahulu.');
    if (p === '/api/admin/harian' && m === 'GET') return adminHarian(env, url);
    if (p === '/api/admin/laporan' && m === 'GET') return adminLaporan(env, url);
    if (p === '/api/admin/pengguna' && m === 'GET') return senaraiPengguna(env);
    if (p === '/api/admin/pengguna' && m === 'POST') return tambahPengguna(req, env);
    if (p === '/api/admin/status' && m === 'POST') return tandaStatus(req, env);
    const padan = p.match(/^\/api\/admin\/pengguna\/(\d+)(\/reset-pin)?$/);
    if (padan && m === 'POST') {
      const id = Number(padan[1]);
      return padan[2] ? resetPin(env, id) : kemaskiniPengguna(req, env, id, sesi);
    }
  }

  throw new RalatApi(404, 'Tidak dijumpai.');
}

// ---------- Utiliti ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function bacaJson(req) {
  try {
    return await req.json();
  } catch {
    throw new RalatApi(400, 'JSON tidak sah.');
  }
}

function teks(v, maks, wajib = false, label = 'Medan') {
  const s = typeof v === 'string' ? v.trim() : '';
  if (wajib && !s) throw new RalatApi(400, `${label} wajib diisi.`);
  if (s.length > maks) throw new RalatApi(400, `${label} terlalu panjang (maks ${maks} aksara).`);
  return s;
}

function tarikhMYT(ms = Date.now()) {
  return new Date(ms + MYT).toISOString().slice(0, 10);
}

function masaMYT(ms) {
  return new Date(ms + MYT).toISOString().slice(11, 16);
}

function sahTarikh(s, label = 'Tarikh') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '') || isNaN(Date.parse(s))) {
    throw new RalatApi(400, `${label} tidak sah (format YYYY-MM-DD).`);
  }
  return s;
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function rawak(n) {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

async function sha256(s) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

async function hashPin(pin, saltHex) {
  const kunci = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ULANGAN },
    kunci,
    256,
  );
  return hex(bits);
}

// Perbandingan masa-tetap untuk dua rentetan hex sama panjang
function samaSelamat(a, b) {
  if (a.length !== b.length) return false;
  let beza = 0;
  for (let i = 0; i < a.length; i++) beza |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return beza === 0;
}

function pinSementara() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

function sahPin(pin) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) throw new RalatApi(400, 'PIN mesti 6 digit.');
  if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    throw new RalatApi(400, 'PIN terlalu mudah diteka. Pilih PIN lain.');
  }
  return pin;
}

function bacaCookie(req, nama) {
  const c = req.headers.get('Cookie') || '';
  for (const bahagian of c.split(';')) {
    const [k, ...v] = bahagian.trim().split('=');
    if (k === nama) return v.join('=');
  }
  return null;
}

function cookieSesi(req, token, umurSaat) {
  const selamat = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `sesi=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${umurSaat}${selamat}`;
}

// ---------- Sesi & log masuk ----------

async function dapatkanSesi(req, env) {
  const token = bacaCookie(req, 'sesi');
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const s = await env.DB.prepare('SELECT * FROM sesi WHERE token_hash = ? AND tamat > ?')
    .bind(await sha256(token), Date.now())
    .first();
  if (!s) return null;
  if (s.pengguna_id == null) return { peranan: 'penyelia', pengguna: null };
  const u = await env.DB.prepare('SELECT * FROM pengguna WHERE id = ? AND aktif = 1').bind(s.pengguna_id).first();
  if (!u) return null;
  return { peranan: u.peranan, pengguna: u };
}

async function semakKunci(env, kunci) {
  const r = await env.DB.prepare('SELECT * FROM cubaan WHERE kunci = ?').bind(kunci).first();
  if (r && r.kunci_hingga > Date.now()) {
    const minit = Math.ceil((r.kunci_hingga - Date.now()) / 60000);
    throw new RalatApi(429, `Terlalu banyak cubaan gagal. Cuba lagi dalam ${minit} minit.`);
  }
}

async function rekodGagal(env, kunci) {
  await env.DB.prepare(
    `INSERT INTO cubaan (kunci, gagal, kunci_hingga) VALUES (?1, 1, 0)
     ON CONFLICT (kunci) DO UPDATE SET
       gagal = CASE WHEN kunci_hingga > 0 AND kunci_hingga <= ?2 THEN 1 ELSE gagal + 1 END,
       kunci_hingga = CASE WHEN (CASE WHEN kunci_hingga > 0 AND kunci_hingga <= ?2 THEN 1 ELSE gagal + 1 END) >= ?3
                      THEN ?4 ELSE 0 END`,
  )
    .bind(kunci, Date.now(), HAD_GAGAL, Date.now() + TEMPOH_KUNCI)
    .run();
}

async function logMasuk(req, env) {
  const b = await bacaJson(req);
  const noPekerja = teks(b.no_pekerja, 40, true, 'No. pekerja').toLowerCase();
  const pin = typeof b.pin === 'string' ? b.pin : '';
  if (!pin || pin.length > 128) throw new RalatApi(400, 'PIN / kata laluan wajib diisi.');

  const kunci = 'login:' + noPekerja;
  await semakKunci(env, kunci);

  let penggunaId = null;
  let peranan;
  let tukarPin = false;

  if (noPekerja === 'admin') {
    if (!env.ADMIN_PASSWORD) throw new RalatApi(503, 'Kata laluan pentadbir belum ditetapkan.');
    const ok = samaSelamat(await sha256(pin), await sha256(env.ADMIN_PASSWORD));
    if (!ok) {
      await rekodGagal(env, kunci);
      throw new RalatApi(401, 'No. pekerja atau PIN salah.');
    }
    peranan = 'penyelia';
  } else {
    const u = await env.DB.prepare('SELECT * FROM pengguna WHERE no_pekerja = ? AND aktif = 1').bind(noPekerja).first();
    // Kira hash walaupun pengguna tiada, supaya masa tindak balas serupa
    const hash = await hashPin(pin, u ? u.pin_salt : '00'.repeat(16));
    if (!u || !samaSelamat(hash, u.pin_hash)) {
      await rekodGagal(env, kunci);
      throw new RalatApi(401, 'No. pekerja atau PIN salah.');
    }
    penggunaId = u.id;
    peranan = u.peranan;
    tukarPin = !!u.tukar_pin;
  }

  await env.DB.prepare('DELETE FROM cubaan WHERE kunci = ?').bind(kunci).run();
  const token = rawak(32);
  await env.DB.prepare('INSERT INTO sesi (token_hash, pengguna_id, peranan, tamat) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), penggunaId, peranan, Date.now() + TEMPOH_SESI)
    .run();

  return json({ ok: true, peranan, tukar_pin: tukarPin, admin: penggunaId == null }, 200, {
    'Set-Cookie': cookieSesi(req, token, TEMPOH_SESI / 1000),
  });
}

async function logKeluar(req, env) {
  const token = bacaCookie(req, 'sesi');
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare('DELETE FROM sesi WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': cookieSesi(req, '', 0) });
}

async function saya(env, sesi) {
  const u = sesi.pengguna;
  const tarikh = tarikhMYT();
  let hariIni = null;
  if (u) {
    hariIni = await env.DB.prepare('SELECT * FROM kehadiran WHERE pengguna_id = ? AND tarikh = ?').bind(u.id, tarikh).first();
  }
  return json({
    tarikh,
    masa_lewat: env.MASA_LEWAT || '08:30',
    peranan: sesi.peranan,
    admin: !u,
    pengguna: u ? { no_pekerja: u.no_pekerja, nama: u.nama, unit: u.unit, tukar_pin: !!u.tukar_pin } : null,
    hari_ini: hariIni ? formatRekod(hariIni, env) : null,
  });
}

async function tukarPin(req, env, sesi) {
  const u = sesi.pengguna;
  if (!u) throw new RalatApi(400, 'Kata laluan pentadbir utama ditukar melalui Cloudflare (secret ADMIN_PASSWORD).');
  const b = await bacaJson(req);
  const kunci = 'tukarpin:' + u.id;
  await semakKunci(env, kunci);
  const lama = await hashPin(typeof b.pin_lama === 'string' ? b.pin_lama : '', u.pin_salt);
  if (!samaSelamat(lama, u.pin_hash)) {
    await rekodGagal(env, kunci);
    throw new RalatApi(400, 'PIN semasa salah.');
  }
  const baru = sahPin(b.pin_baru);
  if (baru === b.pin_lama) throw new RalatApi(400, 'PIN baharu mesti berbeza daripada PIN semasa.');
  const salt = rawak(16);
  await env.DB.batch([
    env.DB.prepare('UPDATE pengguna SET pin_hash = ?, pin_salt = ?, tukar_pin = 0 WHERE id = ?').bind(await hashPin(baru, salt), salt, u.id),
    env.DB.prepare('DELETE FROM cubaan WHERE kunci = ?').bind(kunci),
  ]);
  return json({ ok: true });
}

// ---------- Kehadiran pegawai ----------

function formatRekod(r, env) {
  const lewatMinit = r.masuk ? minitLewat(r.masuk, env) : 0;
  return {
    tarikh: r.tarikh,
    status: r.status,
    masuk: r.masuk ? masaMYT(r.masuk) : null,
    keluar: r.keluar ? masaMYT(r.keluar) : null,
    lewat_minit: lewatMinit,
    masuk_lokasi: r.masuk_lat != null ? { lat: r.masuk_lat, lng: r.masuk_lng, ketepatan: r.masuk_ketepatan } : null,
    keluar_lokasi: r.keluar_lat != null ? { lat: r.keluar_lat, lng: r.keluar_lng, ketepatan: r.keluar_ketepatan } : null,
    masuk_catatan: r.masuk_catatan || '',
    keluar_catatan: r.keluar_catatan || '',
    catatan_penyelia: r.catatan_penyelia || '',
    jam_bekerja: r.masuk && r.keluar ? Math.round(((r.keluar - r.masuk) / 3600000) * 100) / 100 : null,
  };
}

function minitLewat(masukMs, env) {
  const [j, mn] = (env.MASA_LEWAT || '08:30').split(':').map(Number);
  const t = new Date(masukMs + MYT);
  const minit = t.getUTCHours() * 60 + t.getUTCMinutes();
  return Math.max(0, minit - (j * 60 + mn));
}

function bacaLokasi(b) {
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const ketepatan = Number(b.ketepatan);
  if (b.lat == null || b.lng == null || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new RalatApi(400, 'Lokasi GPS diperlukan. Benarkan akses lokasi pada pelayar dan cuba lagi.');
  }
  return { lat, lng, ketepatan: isFinite(ketepatan) ? Math.round(ketepatan) : null };
}

async function daftar(req, env, sesi, jenis) {
  const b = await bacaJson(req);
  const lok = bacaLokasi(b);
  const catatan = teks(b.catatan, 300, false, 'Catatan');
  const u = sesi.pengguna;
  const kini = Date.now();
  const tarikh = tarikhMYT(kini);
  const sedia = await env.DB.prepare('SELECT * FROM kehadiran WHERE pengguna_id = ? AND tarikh = ?').bind(u.id, tarikh).first();

  if (jenis === 'masuk') {
    if (sedia && sedia.masuk) throw new RalatApi(409, `Anda sudah daftar masuk hari ini pada ${masaMYT(sedia.masuk)}.`);
    if (sedia && sedia.status !== 'hadir') {
      throw new RalatApi(409, `Hari ini ditanda "${sedia.status.toUpperCase()}" oleh penyelia. Hubungi penyelia jika ini silap.`);
    }
    await env.DB.prepare(
      `INSERT INTO kehadiran (pengguna_id, tarikh, status, masuk, masuk_lat, masuk_lng, masuk_ketepatan, masuk_catatan)
       VALUES (?, ?, 'hadir', ?, ?, ?, ?, ?)`,
    )
      .bind(u.id, tarikh, kini, lok.lat, lok.lng, lok.ketepatan, catatan)
      .run();
  } else {
    if (!sedia || !sedia.masuk) throw new RalatApi(409, 'Anda belum daftar masuk hari ini.');
    if (sedia.keluar) throw new RalatApi(409, `Anda sudah daftar keluar hari ini pada ${masaMYT(sedia.keluar)}.`);
    await env.DB.prepare(
      'UPDATE kehadiran SET keluar = ?, keluar_lat = ?, keluar_lng = ?, keluar_ketepatan = ?, keluar_catatan = ? WHERE id = ?',
    )
      .bind(kini, lok.lat, lok.lng, lok.ketepatan, catatan, sedia.id)
      .run();
  }
  const r = await env.DB.prepare('SELECT * FROM kehadiran WHERE pengguna_id = ? AND tarikh = ?').bind(u.id, tarikh).first();
  return json({ ok: true, rekod: formatRekod(r, env) });
}

async function sejarah(env, sesi) {
  const { results } = await env.DB.prepare('SELECT * FROM kehadiran WHERE pengguna_id = ? ORDER BY tarikh DESC LIMIT 31')
    .bind(sesi.pengguna.id)
    .all();
  return json({ rekod: results.map((r) => formatRekod(r, env)) });
}

// ---------- Penyelia ----------

async function adminHarian(env, url) {
  const tarikh = sahTarikh(url.searchParams.get('tarikh') || tarikhMYT());
  const { results } = await env.DB.prepare(
    `SELECT p.id AS pid, p.no_pekerja, p.nama, p.unit, k.*
     FROM pengguna p
     LEFT JOIN kehadiran k ON k.pengguna_id = p.id AND k.tarikh = ?
     WHERE p.aktif = 1 OR k.id IS NOT NULL
     ORDER BY p.unit, p.nama`,
  )
    .bind(tarikh)
    .all();

  const ringkasan = { jumlah: 0, hadir: 0, lewat: 0, tidak_hadir_berpunca: 0, belum_daftar: 0, belum_keluar: 0 };
  const senarai = results.map((r) => {
    ringkasan.jumlah++;
    const rek = r.id ? formatRekod(r, env) : null;
    if (!rek) ringkasan.belum_daftar++;
    else if (rek.status !== 'hadir') ringkasan.tidak_hadir_berpunca++;
    else if (rek.masuk) {
      ringkasan.hadir++;
      if (rek.lewat_minit > 0) ringkasan.lewat++;
      if (!rek.keluar) ringkasan.belum_keluar++;
    } else ringkasan.belum_daftar++;
    return { pengguna_id: r.pid, no_pekerja: r.no_pekerja, nama: r.nama, unit: r.unit, rekod: rek };
  });
  return json({ tarikh, masa_lewat: env.MASA_LEWAT || '08:30', ringkasan, senarai });
}

function csvSel(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // elak suntikan formula Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function adminLaporan(env, url) {
  const dari = sahTarikh(url.searchParams.get('dari'), 'Tarikh mula');
  const hingga = sahTarikh(url.searchParams.get('hingga'), 'Tarikh akhir');
  if (dari > hingga) throw new RalatApi(400, 'Tarikh mula mesti sebelum tarikh akhir.');
  if ((Date.parse(hingga) - Date.parse(dari)) / 86400000 > 366) throw new RalatApi(400, 'Julat maksimum 1 tahun.');

  const { results } = await env.DB.prepare(
    `SELECT p.no_pekerja, p.nama, p.unit, k.*
     FROM kehadiran k JOIN pengguna p ON p.id = k.pengguna_id
     WHERE k.tarikh BETWEEN ? AND ?
     ORDER BY k.tarikh, p.unit, p.nama`,
  )
    .bind(dari, hingga)
    .all();

  const baris = results.map((r) => ({ no_pekerja: r.no_pekerja, nama: r.nama, unit: r.unit, ...formatRekod(r, env) }));

  if (url.searchParams.get('format') === 'csv') {
    const lajur = [
      'Tarikh', 'No. Pekerja', 'Nama', 'Unit', 'Status', 'Masuk', 'Keluar', 'Lewat (minit)', 'Jam Bekerja',
      'Lokasi Masuk', 'Ketepatan Masuk (m)', 'Catatan Masuk', 'Lokasi Keluar', 'Ketepatan Keluar (m)', 'Catatan Keluar', 'Catatan Penyelia',
    ];
    const isi = baris.map((r) =>
      [
        r.tarikh, r.no_pekerja, r.nama, r.unit, r.status.toUpperCase(), r.masuk, r.keluar,
        r.status === 'hadir' && r.masuk ? r.lewat_minit : '', r.jam_bekerja,
        r.masuk_lokasi ? `${r.masuk_lokasi.lat},${r.masuk_lokasi.lng}` : '', r.masuk_lokasi?.ketepatan,
        r.masuk_catatan,
        r.keluar_lokasi ? `${r.keluar_lokasi.lat},${r.keluar_lokasi.lng}` : '', r.keluar_lokasi?.ketepatan,
        r.keluar_catatan, r.catatan_penyelia,
      ].map(csvSel).join(','),
    );
    const csv = '﻿' + [lajur.join(','), ...isi].join('\r\n') + '\r\n';
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="kehadiran_${dari}_${hingga}.csv"`,
      },
    });
  }
  return json({ dari, hingga, rekod: baris });
}

async function senaraiPengguna(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, no_pekerja, nama, unit, peranan, aktif, tukar_pin FROM pengguna ORDER BY aktif DESC, unit, nama',
  ).all();
  return json({ pengguna: results });
}

function sahPeranan(v) {
  if (v !== 'pegawai' && v !== 'penyelia') throw new RalatApi(400, 'Peranan tidak sah.');
  return v;
}

async function tambahPengguna(req, env) {
  const b = await bacaJson(req);
  const noPekerja = teks(b.no_pekerja, 40, true, 'No. pekerja');
  if (!/^[A-Za-z0-9._-]+$/.test(noPekerja)) throw new RalatApi(400, 'No. pekerja hanya boleh mengandungi huruf, nombor, titik, sengkang.');
  if (noPekerja.toLowerCase() === 'admin') throw new RalatApi(400, 'No. pekerja "admin" dikhaskan.');
  const nama = teks(b.nama, 100, true, 'Nama');
  const unit = teks(b.unit, 60, false, 'Unit');
  const peranan = sahPeranan(b.peranan || 'pegawai');

  const pin = pinSementara();
  const salt = rawak(16);
  try {
    await env.DB.prepare(
      'INSERT INTO pengguna (no_pekerja, nama, unit, peranan, pin_hash, pin_salt, tukar_pin, aktif, dicipta) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)',
    )
      .bind(noPekerja, nama, unit, peranan, await hashPin(pin, salt), salt, Date.now())
      .run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new RalatApi(409, `No. pekerja ${noPekerja} sudah wujud.`);
    throw e;
  }
  return json({ ok: true, pin_sementara: pin });
}

async function kemaskiniPengguna(req, env, id, sesi) {
  const u = await env.DB.prepare('SELECT * FROM pengguna WHERE id = ?').bind(id).first();
  if (!u) throw new RalatApi(404, 'Pengguna tidak dijumpai.');
  const b = await bacaJson(req);
  const nama = b.nama !== undefined ? teks(b.nama, 100, true, 'Nama') : u.nama;
  const unit = b.unit !== undefined ? teks(b.unit, 60, false, 'Unit') : u.unit;
  const peranan = b.peranan !== undefined ? sahPeranan(b.peranan) : u.peranan;
  const aktif = b.aktif !== undefined ? (b.aktif ? 1 : 0) : u.aktif;
  if (sesi.pengguna && sesi.pengguna.id === id && (aktif === 0 || peranan !== 'penyelia')) {
    throw new RalatApi(400, 'Anda tidak boleh nyahaktif atau turunkan peranan akaun sendiri.');
  }
  const ops = [env.DB.prepare('UPDATE pengguna SET nama = ?, unit = ?, peranan = ?, aktif = ? WHERE id = ?').bind(nama, unit, peranan, aktif, id)];
  if (!aktif || peranan !== u.peranan) ops.push(env.DB.prepare('DELETE FROM sesi WHERE pengguna_id = ?').bind(id));
  await env.DB.batch(ops);
  return json({ ok: true });
}

async function resetPin(env, id) {
  const u = await env.DB.prepare('SELECT id, no_pekerja FROM pengguna WHERE id = ?').bind(id).first();
  if (!u) throw new RalatApi(404, 'Pengguna tidak dijumpai.');
  const pin = pinSementara();
  const salt = rawak(16);
  await env.DB.batch([
    env.DB.prepare('UPDATE pengguna SET pin_hash = ?, pin_salt = ?, tukar_pin = 1 WHERE id = ?').bind(await hashPin(pin, salt), salt, id),
    env.DB.prepare('DELETE FROM sesi WHERE pengguna_id = ?').bind(id),
    env.DB.prepare('DELETE FROM cubaan WHERE kunci IN (?, ?)').bind('login:' + u.no_pekerja.toLowerCase(), 'tukarpin:' + id),
  ]);
  return json({ ok: true, pin_sementara: pin });
}

async function tandaStatus(req, env) {
  const b = await bacaJson(req);
  const id = Number(b.pengguna_id);
  const tarikh = sahTarikh(b.tarikh);
  const status = b.status;
  if (!STATUS_SAH.includes(status)) throw new RalatApi(400, 'Status tidak sah.');
  const catatan = teks(b.catatan, 300, false, 'Catatan');
  const u = await env.DB.prepare('SELECT id FROM pengguna WHERE id = ?').bind(id).first();
  if (!u) throw new RalatApi(404, 'Pengguna tidak dijumpai.');

  const sedia = await env.DB.prepare('SELECT * FROM kehadiran WHERE pengguna_id = ? AND tarikh = ?').bind(id, tarikh).first();
  if (sedia) {
    if (status === 'hadir' && !sedia.masuk) {
      // Batalkan tanda cuti/MC — pegawai boleh daftar masuk semula
      await env.DB.prepare('DELETE FROM kehadiran WHERE id = ?').bind(sedia.id).run();
    } else {
      await env.DB.prepare('UPDATE kehadiran SET status = ?, catatan_penyelia = ? WHERE id = ?').bind(status, catatan, sedia.id).run();
    }
  } else if (status !== 'hadir') {
    await env.DB.prepare('INSERT INTO kehadiran (pengguna_id, tarikh, status, catatan_penyelia) VALUES (?, ?, ?, ?)')
      .bind(id, tarikh, status, catatan)
      .run();
  }
  return json({ ok: true });
}

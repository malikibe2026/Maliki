// Ujian integrasi: jalankan `npx wrangler dev` dahulu, kemudian `npm test`.
// BASE dan ADMIN_PASSWORD boleh ditukar melalui pemboleh ubah persekitaran.
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const ADMIN = process.env.ADMIN_PASSWORD || 'ujian-tempatan-123';

function klien() {
  let cookie = '';
  return async function panggil(laluan, body, method) {
    const opsyen = { method: method || (body ? 'POST' : 'GET'), headers: {} };
    if (cookie) opsyen.headers.Cookie = cookie;
    if (body) {
      opsyen.headers['Content-Type'] = 'application/json';
      opsyen.body = JSON.stringify(body);
    }
    const res = await fetch(BASE + laluan, opsyen);
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const teks = await res.text();
    let data;
    try { data = JSON.parse(teks); } catch { data = teks; }
    return { status: res.status, data, headers: res.headers };
  };
}

const unik = Date.now().toString(36);
const lokasi = { lat: 3.139, lng: 101.6869, ketepatan: 12 };

// Halaman statik
{
  const res = await fetch(BASE + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Sistem Kehadiran/);
}

const admin = klien();
assert.equal((await admin('/api/saya')).status, 401, 'tanpa sesi mesti 401');
assert.equal((await admin('/api/log-masuk', { no_pekerja: 'admin', pin: 'salah' })).status, 401);
let r = await admin('/api/log-masuk', { no_pekerja: 'admin', pin: ADMIN });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.admin, true);

// Tambah pegawai
r = await admin('/api/admin/pengguna', { no_pekerja: 'P' + unik, nama: 'Ali bin Abu', unit: 'Zon A' });
assert.equal(r.status, 200, JSON.stringify(r.data));
const pinSementara = r.data.pin_sementara;
assert.match(pinSementara, /^\d{6}$/);
r = await admin('/api/admin/pengguna', { no_pekerja: 'p' + unik, nama: 'Pendua' });
assert.equal(r.status, 409, 'no. pekerja pendua (tak sensitif huruf) mesti ditolak');

// Pegawai log masuk & mesti tukar PIN
const peg = klien();
r = await peg('/api/log-masuk', { no_pekerja: 'p' + unik, pin: pinSementara });
assert.equal(r.status, 200);
assert.equal(r.data.tukar_pin, true);
assert.equal((await peg('/api/daftar-masuk', lokasi)).status, 403, 'mesti tukar PIN dahulu');
assert.equal((await peg('/api/tukar-pin', { pin_lama: pinSementara, pin_baru: '123456' })).status, 400, 'PIN mudah ditolak');
assert.equal((await peg('/api/tukar-pin', { pin_lama: pinSementara, pin_baru: '482913' })).status, 200);

// Pegawai tidak boleh akses penyelia
assert.equal((await peg('/api/admin/harian')).status, 403);

// Daftar masuk / keluar
assert.equal((await peg('/api/daftar-masuk', { catatan: 'tiada lokasi' })).status, 400, 'lokasi wajib');
assert.equal((await peg('/api/daftar-keluar', lokasi)).status, 409, 'belum masuk');
r = await peg('/api/daftar-masuk', { ...lokasi, catatan: 'Blok 12' });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.match(r.data.rekod.masuk, /^\d{2}:\d{2}$/);
assert.equal((await peg('/api/daftar-masuk', lokasi)).status, 409, 'tidak boleh masuk dua kali');
r = await peg('/api/daftar-keluar', lokasi);
assert.equal(r.status, 200);
assert.equal((await peg('/api/daftar-keluar', lokasi)).status, 409, 'tidak boleh keluar dua kali');
r = await peg('/api/sejarah');
assert.equal(r.data.rekod.length, 1);

// Papan penyelia
r = await admin('/api/admin/harian');
assert.equal(r.status, 200);
const baris = r.data.senarai.find((x) => x.no_pekerja === 'P' + unik);
assert.ok(baris && baris.rekod && baris.rekod.masuk, 'rekod pegawai dipaparkan');
const pid = baris.pengguna_id;

// Tanda MC untuk esok, kemudian batal
const esok = new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10);
assert.equal((await admin('/api/admin/status', { pengguna_id: pid, tarikh: esok, status: 'mc', catatan: '=CMD()' })).status, 200);
r = await admin(`/api/admin/harian?tarikh=${esok}`);
assert.equal(r.data.senarai.find((x) => x.pengguna_id === pid).rekod.status, 'mc');

// CSV
const hari = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
r = await admin(`/api/admin/laporan?format=csv&dari=${hari}&hingga=${esok}`);
assert.equal(r.status, 200);
assert.match(r.headers.get('content-type'), /text\/csv/);
assert.ok(r.data.includes('Ali bin Abu'));
assert.ok(r.data.includes("'=CMD()"), 'suntikan formula dineutralkan');
assert.equal((await admin('/api/admin/status', { pengguna_id: pid, tarikh: esok, status: 'hadir' })).status, 200);
r = await admin(`/api/admin/harian?tarikh=${esok}`);
assert.equal(r.data.senarai.find((x) => x.pengguna_id === pid).rekod, null, 'tanda MC dibatalkan');

// Kunci akaun selepas 5 cubaan gagal
const jahat = klien();
for (let i = 0; i < 5; i++) assert.equal((await jahat('/api/log-masuk', { no_pekerja: 'P' + unik, pin: '000001' })).status, 401);
assert.equal((await jahat('/api/log-masuk', { no_pekerja: 'P' + unik, pin: '482913' })).status, 429, 'akaun dikunci');

// Reset PIN buka kunci dan batalkan sesi lama
r = await admin(`/api/admin/pengguna/${pid}/reset-pin`, {});
assert.equal(r.status, 200);
assert.equal((await peg('/api/saya')).status, 401, 'sesi lama dibatalkan');
assert.equal((await jahat('/api/log-masuk', { no_pekerja: 'P' + unik, pin: r.data.pin_sementara })).status, 200, 'kunci dibuka selepas reset');

// Nyahaktif
assert.equal((await admin(`/api/admin/pengguna/${pid}`, { aktif: false })).status, 200);
assert.equal((await jahat('/api/saya')).status, 401, 'pengguna tidak aktif terkeluar');

// Log keluar
await admin('/api/log-keluar', {});
assert.equal((await admin('/api/saya')).status, 401);

console.log('Semua ujian lulus.');

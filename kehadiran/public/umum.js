// Fungsi kongsi untuk semua halaman
async function api(laluan, pilihan = {}) {
  const opsyen = { method: pilihan.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (pilihan.body !== undefined) {
    opsyen.method = pilihan.method || 'POST';
    opsyen.headers['Content-Type'] = 'application/json';
    opsyen.body = JSON.stringify(pilihan.body);
  }
  let res;
  try {
    res = await fetch(laluan, opsyen);
  } catch {
    throw new Error('Tiada sambungan internet. Cuba lagi.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !pilihan.biar401) {
    location.href = '/';
    throw new Error('Sesi tamat.');
  }
  if (!res.ok) throw new Error(data.ralat || 'Ralat ' + res.status);
  return data;
}

function $(s) {
  return document.querySelector(s);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function papar(el, teks, jenis = 'ralat') {
  el.textContent = teks;
  el.className = 'mesej ' + jenis;
  el.classList.toggle('tersorok', !teks);
}

function tarikhPanjang(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('ms-MY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function pautanPeta(lok) {
  if (!lok) return '';
  const t = lok.ketepatan != null ? ` ±${lok.ketepatan}m` : '';
  return `<a href="https://www.google.com/maps?q=${lok.lat},${lok.lng}" target="_blank" rel="noopener">Peta</a><span class="kecil-teks">${t}</span>`;
}

function tempoh(minit) {
  return minit < 60 ? `${minit} min` : `${Math.floor(minit / 60)} j ${minit % 60} min`;
}

function lencanaStatus(rek) {
  if (!rek) return '<span class="lencana tiada">Belum daftar</span>';
  if (rek.status !== 'hadir') return `<span class="lencana ${rek.status}">${rek.status.toUpperCase()}</span>`;
  if (!rek.masuk) return '<span class="lencana tiada">Belum daftar</span>';
  if (rek.lewat_minit > 0) return `<span class="lencana lewat">Lewat ${tempoh(rek.lewat_minit)}</span>`;
  return '<span class="lencana hadir">Hadir</span>';
}

async function logKeluar() {
  await api('/api/log-keluar', { body: {} }).catch(() => {});
  location.href = '/';
}

function dapatkanLokasi() {
  return new Promise((selesai, gagal) => {
    if (!navigator.geolocation) return gagal(new Error('Peranti ini tidak menyokong GPS.'));
    navigator.geolocation.getCurrentPosition(
      (p) => selesai({ lat: p.coords.latitude, lng: p.coords.longitude, ketepatan: p.coords.accuracy }),
      (e) => {
        const m = {
          1: 'Akses lokasi ditolak. Benarkan lokasi untuk laman ini dalam tetapan pelayar, kemudian cuba lagi.',
          2: 'Lokasi tidak dapat dikesan. Pastikan GPS dihidupkan.',
          3: 'Mengesan lokasi mengambil masa terlalu lama. Cuba lagi di kawasan terbuka.',
        };
        gagal(new Error(m[e.code] || 'Gagal mendapatkan lokasi.'));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

# Sistem Kehadiran (Cloudflare Workers + D1)

Sistem kehadiran untuk pegawai lapangan. Pegawai daftar masuk/keluar dari telefon dengan lokasi GPS. Penyelia pantau kehadiran harian, tanda cuti/MC/kursus, urus pegawai dan muat turun laporan CSV.

## Ciri
**Pegawai** (`/pegawai`)
- Daftar masuk dan daftar keluar sekali sehari. Masa diambil dari pelayan (bukan telefon), lokasi GPS dan ketepatannya direkod.
- Catatan lokasi tugasan (pilihan).
- Rekod 31 hari terakhir.

**Penyelia** (`/penyelia`)
- Kehadiran harian: ringkasan (hadir, lewat, cuti/MC/kursus, belum daftar, belum daftar keluar), carian, tapisan, pautan Google Maps.
- Tanda status Cuti / MC / Kursus / Lain-lain, atau batalkan.
- Laporan julat tarikh (maks 1 tahun) dan eksport CSV (UTF-8 BOM, sesuai Excel).
- Tambah pegawai, ubah maklumat/peranan, set semula PIN, nyahaktif.

## Akaun
- **Pentadbir utama**: No. pekerja `admin`, kata laluan = secret `ADMIN_PASSWORD`.
- **Pegawai / penyelia**: ditambah oleh penyelia. Sistem jana PIN sementara 6 digit; pegawai wajib tukar PIN semasa log masuk pertama.
- 5 cubaan log masuk gagal → akaun dikunci 15 minit. Set semula PIN akan membuka kunci.

## Tetapan
`wrangler.toml`:
- `MASA_LEWAT` — masa selepas ini dikira lewat (waktu Malaysia), lalai `08:30`.
- Cron harian membersihkan sesi tamat tempoh.

## Deploy
Pangkalan data D1 `kehadiran-db` sudah dicipta dan skema sudah dipasang.

### Pilihan A: GitHub Actions (tanpa komputer)
1. Cipta API token Cloudflare (lihat kebenaran di bawah).
2. Di GitHub: repo > Settings > Secrets and variables > Actions > New repository secret:
   - `CLOUDFLARE_API_TOKEN` — token di atas
   - `ADMIN_PASSWORD` — kata laluan pentadbir (minimum 12 aksara)
   - `CLOUDFLARE_ACCOUNT_ID` — pilihan; diperlukan jika token boleh akses lebih dari satu akaun
3. Tab Actions > **Deploy Sistem Kehadiran** > Run workflow. Push ke folder `kehadiran/` juga akan deploy secara automatik.

### Pilihan B: Dari komputer
```bash
cd kehadiran
npm install
npx wrangler login
npx wrangler d1 migrations apply kehadiran-db --remote
npx wrangler deploy
npx wrangler secret put ADMIN_PASSWORD
```

### Kebenaran API token (Custom token)
| Jenis | Kebenaran | Tahap |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |
| Account | Account Settings | Read |
| User | Memberships | Read |
| User | User Details | Read |

Account Resources: Include > akaun anda. Tidak perlu kebenaran Zone.

## Pembangunan tempatan
```bash
npm install
echo 'ADMIN_PASSWORD="ujian-tempatan-123"' > .dev.vars
npm run db:local
npm run dev        # http://localhost:8787
npm test           # dalam terminal lain
```

## Had dan risiko yang perlu tahu
- **GPS boleh dipalsukan** dengan aplikasi "fake GPS" pada Android. Sistem merekod koordinat dan ketepatan sahaja; ia bukan bukti mutlak. Semak rekod yang ketepatannya pelik (cth. ±0m atau sangat besar).
- **PIN dikongsi = boleh daftar bagi pihak orang lain.** Tiada swafoto/biometrik. Boleh ditambah kemudian (R2 untuk gambar).
- Tiada kalendar cuti umum/hujung minggu — "Belum daftar" dikira untuk semua hari.
- Kunci akaun selepas 5 cubaan gagal boleh disalah guna oleh orang yang tahu no. pekerja seseorang untuk mengunci akaun itu selama 15 minit.
- Data peribadi (lokasi) disimpan di Cloudflare. Pastikan selaras dengan dasar keselamatan data jabatan sebelum guna rasmi.

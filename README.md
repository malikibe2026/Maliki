# Kuiz Live

Kuiz interaktif masa nyata (gaya Kahoot). Host papar soalan dan ranking di skrin/projektor; peserta sertai menggunakan telefon.

## Ciri
- Lobi: nampak peserta yang masuk secara langsung
- Soalan dipaparkan di skrin dengan pemasa dan 4 pilihan berwarna
- Peserta jawab di telefon; mata lebih tinggi jika jawab lebih pantas
- Jawapan didedahkan dengan kiraan undi setiap pilihan
- Ranking selepas setiap soalan dan podium akhir

## Keperluan
- Node.js 18 atau lebih baru. Tiada `npm install` diperlukan (tiada dependency luar).

## Cara guna
1. Jalankan pelayan di komputer host:
   ```bash
   npm start
   ```
   Terminal akan papar alamat untuk host dan peserta.
2. Pastikan telefon peserta dan komputer host berada dalam rangkaian Wi-Fi yang sama.
3. Host buka `http://localhost:3000/host.html`, klik **Cipta bilik kuiz**, dan papar skrin ke projektor.
4. Peserta buka alamat `http://<IP-komputer>:3000/play.html` di telefon, masukkan kod 6 digit dan nama.
5. Host klik **Mula kuiz** apabila peserta sudah masuk.
6. Setiap soalan: **Dedahkan jawapan** (atau tunggu pemasa tamat / semua sudah jawab), kemudian **Soalan seterusnya**.

## Tukar soalan
Edit `quiz.json`:
- `title`: tajuk kuiz
- `questions[].text`: soalan
- `questions[].options`: 2 hingga 4 pilihan
- `questions[].answer`: indeks jawapan betul, bermula dari 0
- `questions[].limit`: masa dalam saat (minimum 5)

Mulakan semula pelayan selepas menukar `quiz.json`.

## Peraturan mata
- Jawapan betul: 1000 mata jika dijawab serta-merta, turun secara linear hingga 500 mata pada saat akhir.
- Jawapan salah atau tidak menjawab: 0 mata.

## Eksport keputusan
Selepas kuiz tamat, host klik **Muat turun keputusan (CSV)**. Fail mengandungi kedudukan, nama, jumlah mata, dan jawapan serta mata bagi setiap soalan. Fail dikodkan UTF-8 dengan BOM supaya Excel papar dengan betul.

## Simpanan keadaan
- Keadaan bilik disimpan dalam `data/rooms.json` (dicipta automatik, diabaikan oleh git).
- Jika pelayan di-restart, bilik dipulihkan. Peserta boleh sambung semula dengan telefon yang sama.
- Soalan yang sedang dibuka semasa restart akan terus didedahkan, kerana pemasa tidak boleh disambung semula.
- Tukar lokasi simpanan dengan `DATA_DIR=/laluan/lain npm start`.

## Rangkaian dan firewall (penting)
- Telefon peserta dan komputer host mesti dalam rangkaian Wi-Fi yang sama.
- Port 3000 mesti dibenarkan oleh firewall komputer host:
  - Windows: Windows Defender Firewall > Allow an app > benarkan Node.js untuk rangkaian Private, atau cipta peraturan masuk untuk TCP 3000.
  - macOS: System Settings > Network > Firewall, benarkan Node.
- Wi-Fi sekolah/pejabat selalunya menyekat komunikasi sesama peranti (client isolation). Jika telefon tidak boleh capai alamat host, minta pentadbir rangkaian benarkan, atau guna hotspot telefon host.
- Pelayan terikat pada `0.0.0.0` supaya peranti lain boleh masuk. Tukar dengan `HOST=127.0.0.1` jika mahu hanya komputer sendiri.

## Keselamatan
- Token host dan ID peserta dihantar dalam header HTTP, bukan dalam URL.
- Gunakan dalam rangkaian yang dipercayai sahaja. Jangan dedahkan ke internet tanpa HTTPS dan pengesahan tambahan.
- Bilik tanpa aktiviti selama 4 jam akan dipadam.

## Ujian
```bash
npm test
```
Ujian ini menjalankan pelayan sementara dengan 30 peserta serentak, melengkapkan kuiz, menguji eksport CSV, dan menguji restart pelayan.

## Skill audit keselamatan (Claude Code)
Repo ini mengandungi skill `security-audit` daripada Cloudflare di `.claude/skills/security-audit/` (lesen MIT, sumber dalam `SOURCE.md`). Bila Claude Code dibuka dalam repo ini, minta contohnya:
```
buat audit keselamatan untuk server.js
```
Soalan biasa guna mod panduan. Audit penuh (6 fasa, fail laporan) hanya berjalan bila diminta secara jelas, dan laporan ditulis di luar repo (`~/security-audit-skill/<repo>/run-N`) secara lalai.

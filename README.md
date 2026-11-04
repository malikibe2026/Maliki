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

## Nota
- Bilik disimpan dalam memori. Jika pelayan dimulakan semula, semua bilik hilang.
- Bilik tanpa aktiviti selama 4 jam akan dipadam.
- Token host disimpan dalam `sessionStorage` pelayar host dan dihantar dalam URL stream. Gunakan dalam rangkaian yang dipercayai sahaja (LAN sekolah/pejabat), jangan dedahkan ke internet tanpa HTTPS dan pengesahan tambahan.
- Pelayan terikat pada `0.0.0.0` supaya peserta dalam rangkaian yang sama boleh masuk.

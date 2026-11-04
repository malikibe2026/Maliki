# Tema HP

Launcher Android minimalis. Ringan untuk telefon lama.

## Ciri
- Jam dan tarikh (Bahasa Melayu)
- Waktu solat dari API e-Solat JAKIM, dengan kiraan detik waktu seterusnya
- Bateri dan storan kosong
- Carian aplikasi (tekan aplikasi untuk buka)
- Tahan kad waktu solat untuk tukar kod zon (contoh: `SGR01`)

## Keperluan
- Android 7.0 (API 24) atau lebih baru
- Tiada dependency luar (hanya SDK Android)

## Bina APK

### Cara 1: Android Studio (disyorkan)
1. Buka Android Studio, pilih **Open**, dan pilih folder `tema-hp`.
2. Tunggu Gradle sync selesai. Studio akan memuat turun SDK yang diperlukan.
3. **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. APK berada di `app/build/outputs/apk/debug/app-debug.apk`.

### Cara 2: Command line
Perlu Android SDK (`ANDROID_HOME`) dan Gradle 8.x:
```bash
cd tema-hp
gradle assembleDebug
```
APK: `app/build/outputs/apk/debug/app-debug.apk`

## Pasang di telefon
1. Salin APK ke telefon, dan benarkan pemasangan dari sumber luar (Settings > Install unknown apps).
2. Pasang APK.
3. Tetapkan sebagai launcher: tekan **Home**, pilih **Tema HP**, dan pilih **Sentiasa** (Always).
   Atau: Settings > Apps > Default apps > Home app.

## Kod zon JAKIM
Cari kod zon anda di https://www.e-solat.gov.my (contoh: `SGR01` Gombak/Hulu Langat/Sepang, `WLY01` Kuala Lumpur/Putrajaya). Tahan kad waktu solat di skrin utama untuk memasukkan kod.

## Nota teknikal
- Waktu solat dimuat turun sekali sebulan dan di-cache dalam telefon. Tanpa internet, cache lama masih dipakai untuk bulan yang sama.
- Endpoint yang digunakan: `https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=month&zone=KODZON`. Jika JAKIM menukar endpoint atau format JSON, kemas kini `PrayerTimes.kt`.
- Pemasa kiraan turun dikemas kini setiap saat. Bateri dan storan dikemas kini setiap 30 saat.

## Status pengesahan
- Kod ini ditulis tanpa dibina atau diuji pada telefon. Ia belum disahkan oleh compiler Android.
- Endpoint JAKIM belum diuji dari persekitaran pembangunan ini. Sahkan respons pertama di telefon sebenar.

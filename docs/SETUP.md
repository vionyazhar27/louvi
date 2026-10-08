# Setup louvi

louvi adalah kumpulan file statis. Tidak perlu install apa pun untuk *menjalankannya*, tapi browser hanya mau memuat file JavaScript modern (ES modules) lewat alamat `http://` atau `https://`, bukan dengan double-click `index.html`. Jadi pilih salah satu cara di bawah.

## A. Online di GitHub Pages (disarankan, gratis)

Hasilnya: alamat seperti `https://<username>.github.io/louvi/` yang bisa dibuka di laptop dan HP.

1. Login ke github.com → klik **New repository**.
   - Nama: `louvi`
   - Visibility: **Public** (GitHub Pages gratis hanya untuk repo publik; *kode*-nya saja yang publik, **data kamu tidak ikut** karena data tersimpan di browser, bukan di repo).
   - Klik **Create repository**.
2. Di halaman repo baru, klik **uploading an existing file**.
3. Extract `louvi.zip`, lalu drag **isi** folder `louvi` (file `index.html`, folder `css`, `js`, `fonts`, dst.) ke halaman upload. Pastikan `index.html` ada di level paling atas, bukan di dalam subfolder.
4. Klik **Commit changes**.
5. Buka **Settings → Pages**. Pada *Build and deployment*, Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)** → **Save**.
6. Tunggu 1–2 menit, refresh halaman Settings → Pages. Alamat louvi akan muncul di atas. Buka, lalu bookmark.

### Update ke versi baru
Upload **semua** file dari zip versi baru dengan cara yang sama (langkah 2–4); file dengan nama sama akan ditimpa. **Data kamu tidak terpengaruh** karena data ada di browser (dan di repo sync), bukan di file aplikasi. Setelah 1–2 menit, louvi yang terbuka akan menampilkan *"A new version of louvi is ready"* → ketuk **Update now**.

Kalau kamu mengubah kode sendiri: naikkan `APP_VERSION` di `js/schema.js` **dan** `VERSION` di `sw.js` (harus sama), lalu jalankan `node tests/sw-files.test.mjs` untuk memastikan semua file terdaftar di service worker.

## C. Sync HP ↔ laptop (repo GitHub privat)

Sekali saja:
1. Buka https://github.com/new → nama **`louvi-data`** → pilih **Private** → *Create repository*. (Repo ini **beda** dari repo `louvi` yang berisi aplikasinya.)
2. Buat token: https://github.com/settings/personal-access-tokens/new
   - Token name: `louvi`
   - Expiration: pilih yang paling lama yang tersedia (catat tanggalnya; louvi akan memberi tahu kalau token sudah tidak berlaku)
   - Repository access: **Only select repositories** → `louvi-data`
   - Permissions → Repository permissions → **Contents: Read and write**
   - *Generate token* → salin tokennya (diawali `github_pat_`). GitHub hanya menampilkannya sekali; simpan di password manager.

Di setiap perangkat (laptop, lalu HP):
3. Buka louvi (alamat GitHub Pages) → **Settings → Sync between devices → Set up sync**.
4. Isi username GitHub, nama repo `louvi-data`, token, dan nama perangkat (mis. *Laptop* / *HP*) → **Connect & sync**.

Cara kerjanya:
- louvi menyimpan satu file `louvi-data.json` di repo itu. Setiap sync = satu commit, jadi ada **riwayat versi** (Settings → *Version history*).
- Sync otomatis: saat louvi dibuka, ~20 detik setelah ada perubahan, saat kembali ke app, dan saat internet kembali. Bisa juga **Sync now**.
- Data dari dua perangkat **digabung per item**. Kalau item yang sama diubah di dua perangkat sebelum sync, perubahan yang terakhir yang dipakai.
- Hapus, reset, dan restore backup ikut tersinkron ke perangkat lain.
- Token hanya tersimpan di browser perangkat itu; tidak ikut backup maupun file sync. **Disconnect this device** menghapusnya dari perangkat itu.
- Repo **publik ditolak**, supaya data keuanganmu tidak bisa dibaca orang lain.

Kalau token kedaluwarsa: louvi menampilkan banner merah. Buat token baru (langkah 2), lalu di tiap perangkat: Disconnect → Set up sync lagi. Data tidak hilang.

## D. Install sebagai app
- **Android (Chrome):** menu ⋮ → *Add to Home screen* / *Install app*.
- **iPhone (Safari):** tombol Share → *Add to Home Screen*.
- **Laptop (Chrome/Edge):** ikon install di kanan address bar.

Setelah di-install, louvi bisa dibuka tanpa internet (sync menunggu sampai online).

## E. Import lamaran dari Google Sheets
1. Di Google Sheets: **File → Download → Comma-separated values (.csv)** (untuk sheet/tab yang berisi daftar lamaran).
2. louvi → **Career → Import** → pilih file CSV tadi.
3. Cek pratinjau: kolom yang dikenali, status hasil pemetaan, dan opsi menandai lamaran yang menunggu > 90 hari sebagai *No response*. Lalu **Add**.
Kolom yang dikenali (huruf besar/kecil bebas): Tanggal Apply/Date, Platform/Source, Web Link/Link, Perusahaan/Company, Lokasi/Location, Position/Posisi, Progress, Final Progress/Status, Catatan/Notes. Import ulang file yang sama tidak membuat duplikat.

> Catatan: data di browser terikat ke *alamat*. louvi di `github.io` dan louvi di `localhost` punya data yang terpisah. Pindahkan data antar-alamat lewat Settings → Download backup → Restore.

## B. Jalankan di laptop (untuk mencoba atau mengedit)

Pilih salah satu:
- **VS Code**: install ekstensi *Live Server*, buka folder `louvi`, klik kanan `index.html` → *Open with Live Server*.
- **Python** (kalau sudah terpasang): di folder `louvi`, jalankan `python -m http.server 8000`, lalu buka `http://localhost:8000`.

## Menjalankan test
- Browser: buka `/tests/index.html` lewat server yang sama (mis. `http://localhost:8000/tests/`).
- Terminal (butuh Node.js): `node tests/run-node.mjs`.

## Kebiasaan backup
- Settings → **Download backup**, minimal 2 minggu sekali (Home akan mengingatkan).
- Simpan file `louvi-backup-….json` di Google Drive.
- Restore: Settings → **Choose backup file** → cek ringkasan → **Replace my data**. Data lama otomatis disimpan sebagai *Automatic backup* dulu.

## Kalau ada masalah
| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Halaman kosong / "taking too long to start" | File belum ter-upload lengkap atau dibuka via double-click | Cek semua folder ter-upload; buka lewat alamat http(s) |
| "Not saved on this device" | Mode private/incognito atau storage diblokir | Buka di jendela biasa |
| Data hilang setelah clear browsing data | Browser menghapus data situs | Restore dari file backup terakhir |
| Perubahan dari tab lain tidak muncul | — | louvi menyinkronkan antar-tab otomatis; kalau ragu, refresh |
| "Sync problem" / banner merah sync | Token kedaluwarsa, repo diganti nama, atau akses token kurang | Settings → baca pesannya → buat token baru → Disconnect → Set up sync |
| Data di HP dan laptop beda | Salah satu belum sync | Buka Settings → **Sync now** di kedua perangkat |

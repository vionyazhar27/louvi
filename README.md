# louvi — *your personal life* dashboard

Dashboard pribadi untuk mengelola tugas, tesis, karier, keuangan, dan rencana hidup.
Satu aplikasi web statis: HTML, CSS, dan JavaScript biasa. Tanpa framework, tanpa build step, tanpa server, tanpa biaya.

**Status:** v0.4.1 — Home, Tasks, Career, Finance, Settings, sync HP–laptop lewat GitHub privat, bisa di-install sebagai app.

## Mulai cepat
- Cara menjalankan di laptop dan online di GitHub Pages: [docs/SETUP.md](docs/SETUP.md)
- Struktur data dan format backup: [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- Riwayat perubahan: [CHANGELOG.md](CHANGELOG.md)

## Struktur folder
```
index.html            kerangka halaman (sidebar, tab bar HP)
css/tokens.css        warna, font, ukuran (ubah tema di sini)
css/base.css          reset + layout shell (desktop & HP)
css/components.css    tombol, form, kartu, daftar tugas, dialog, dll.
js/app.js             titik masuk: memuat data & berpindah halaman
js/store.js           satu-satunya pintu baca/tulis data
js/storage.js         penyimpanan browser (IndexedDB → localStorage → memori)
js/schema.js          bentuk data, daftar area, validasi
js/migrations.js      upgrade data lama saat struktur berubah
js/backup.js          export/import (fungsi murni, ada test-nya)
js/sync.js            sync ke repo GitHub privat (lib/merge.js = aturan penggabungan)
sw.js                 service worker: offline + update (daftar file dicek oleh tests/sw-files.test.mjs)
manifest.webmanifest  data untuk install sebagai app
js/theme.js           terang / gelap / ikut perangkat
js/lib/               logika murni: tanggal, pengulangan, tugas, links, rupiah, karier, keuangan
js/ui/                komponen UI: dialog, toast, ikon, editor link, grafik garis
js/modules/           halaman: home, tasks, career, finance, settings (+ *-actions / task-ui bersama)
fonts/                Plus Jakarta Sans & Nunito (disimpan lokal, jalan offline)
tests/                unit test logika (browser: tests/index.html, terminal: node tests/run-node.mjs; cek service worker: node tests/sw-files.test.mjs)
docs/                 dokumentasi
```

## Prinsip
- Data milikmu: semua tersimpan di browser dan bisa di-export ke satu file JSON.
- Tidak ada yang terhapus diam-diam: hapus → Trash (30 hari), import/reset → backup otomatis dulu.
- Tidak ada dependency eksternal: tidak akan "rusak sendiri" karena library kedaluwarsa.

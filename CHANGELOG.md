# Changelog

## 0.4.1 — 8 Oct 2026
- Tagline: *your personal life* dashboard ("your personal life" miring).

## 0.4.0 — 8 Oct 2026 (Tahap 1d: Sync & install)
- **Sync antar perangkat** lewat repository GitHub **privat** milik sendiri: setup di Settings → Sync between devices. Sync otomatis saat app dibuka, ~20 detik setelah ada perubahan, saat kembali ke app, dan saat online lagi. Penggabungan per item (yang terakhir diubah menang), hapus/reset/restore ikut tersinkron. Token hanya tersimpan di browser perangkat itu. Repo publik ditolak. Riwayat versi tersedia di GitHub.
- **Install sebagai app** (PWA): ikon di home screen, jalan offline, notifikasi "versi baru tersedia".
- **Import lamaran dari spreadsheet (CSV)** di Career: deteksi kolom Indonesia/Inggris, tanggal format Indonesia ("Kamis, 13 Maret 2025"), pemetaan status, pratinjau sebelum menambah, opsi menandai lamaran yang menunggu > 90 hari sebagai No response, lewati duplikat, Undo.
- **Kategori baru langsung dari form transaksi** (tombol New), termasuk opsi "Counts as saving".
- Tagline: *your personal* life dashboard.
- Reset dan restore kini dicatat sebagai versi terbaru (supaya tidak "dikembalikan" oleh perangkat lain saat sync).

## 0.3.0 — 8 Oct 2026 (Tahap 1c: Finance)
- **Accounts**: bank, e-wallet, cash, investasi, emas (gram), dan utang/cicilan (mis. cicilan emas). Akun bisa diarsipkan tanpa menghapus riwayat.
- **Monthly balances**: sekali sebulan isi saldo tiap akun (otomatis diisi dari bulan sebelumnya) + harga emas per gram. Ini sumber **net worth** = aset − utang, lengkap dengan total langsung saat mengisi dan riwayat per bulan yang bisa dikoreksi.
- **Transactions**: Money in / Money out dengan kategori; tombol "Save & add another"; navigasi per bulan; pencarian. Kategori bertanda **Saving** (cicilan emas, top-up investasi, transfer tabungan) dipisahkan dari pengeluaran. Kategori bisa ditambah, diganti nama (transaksi ikut diperbarui) dan ditandai saving.
- **Overview**: net worth + perubahan vs bulan lalu, grafik net worth per bulan, ringkasan bulan ini (masuk / keluar / ditabung / sisa) dan pengeluaran per kategori, ringkasan tahunan per bulan.
- **Savings goals**: target, tenggat, dan akun tempat uangnya disimpan. Progres mengikuti saldo akun tersebut. Menampilkan kebutuhan per bulan beserta cara hitungnya, laju rata-rata 3 bulan terakhir, dan perkiraan bulan tercapai (nominal, tanpa return/inflasi).
- **Home**: kartu Money (net worth, pengingat update saldo, ringkasan bulan ini, goal terdekat).
- Navigasi HP: tab bar sekarang Home · Tasks · + · Career · Finance; Settings lewat ikon di kanan atas.
- Data version 3.

## 0.2.0 — 8 Oct 2026 (Tahap 1b: Career)
- **Career → Applications**: catat lamaran (posisi, perusahaan, lokasi, mode kerja, sumber, tanggal melamar, gaji per bulan, job description, catatan, links). Status: Saved, Applied, Screening & tests, Interviewing, Offer, Accepted, Rejected, No response, Withdrawn, dengan riwayat perubahan status.
- Filter Active / Closed / All, filter per tahap, pencarian (perusahaan, posisi, skill).
- **Interview & tes** per lamaran (HR, user, technical, psikotes, MCU, final) dengan tanggal, jam, hasil, dan catatan. Menambah interview otomatis memindahkan status ke Interviewing (bisa dibatalkan).
- **Follow-up** lamaran otomatis menjadi tugas di Tasks (area Career), terhubung ke lamarannya. Tugas follow-up ikut masuk Trash kalau lamaran ditutup atau dihapus (bisa Undo).
- Penanda "No news for N days" untuk lamaran yang 30+ hari tanpa kabar.
- **Career → Skills**: daftar skill dengan level 1–5 (penilaian sendiri), skill match per lamaran, dan daftar "Worth improving" dari skill yang paling sering diminta lamaran aktif.
- **Home**: interview hari ini di kartu Today, interview di agenda 14 hari, kartu Job search.
- Input gaji fleksibel: `8000000`, `8.000.000`, `8jt`, `8,5 jt`, `750rb`.
- Data version 2 (migrasi otomatis dari versi 1, dengan backup otomatis sebelum upgrade).
- Perbaikan: notifikasi (Undo) kini tampil di atas dialog yang sedang terbuka; form tidak tertutup kalau klik di luar dialog.

## 0.1.1 — 8 Oct 2026
- Nama ditulis **louvi** (huruf kecil).
- Font judul diganti ke Nunito (rounded, lebih santai); teks isi tetap Plus Jakarta Sans.
- **Links di tugas**: tambah link (Google Drive, lowongan, DOI, dll.) dengan label opsional. Link tanpa `https://` dilengkapi otomatis; hanya link http(s) yang diterima. Tugas dengan satu link punya tombol buka langsung di daftar. Link ikut tersalin saat tugas berulang dan ikut dicari.

## 0.1.0 — 8 Oct 2026 (Tahap 1a)
- Fondasi: penyimpanan IndexedDB dengan fallback, migrasi data, sinkron antar-tab, Trash 30 hari.
- **Tasks**: satu daftar untuk semua area (Work, Thesis, Career, Personal, Plans); tampilan Today / Upcoming / All open / Done; filter area; pencarian; quick add; tugas berulang (harian, hari kerja, mingguan, bulanan); undo saat centang & hapus.
- **Home**: sapaan, tugas hari ini + terlambat, 14 hari ke depan, jumlah tugas per area, pengingat backup.
- **Settings**: nama, tema terang/gelap/ikut perangkat, download & copy backup, restore dengan pratinjau, automatic backups, Trash, status penyimpanan, reset.
- Responsif (sidebar di desktop, tab bar di HP), mode gelap, 31 unit test.

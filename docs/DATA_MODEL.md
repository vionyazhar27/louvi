# louvi — Data model

Semua data louvi adalah **satu dokumen JSON**. Dokumen yang sama dipakai untuk penyimpanan di browser dan untuk file backup, jadi backup = salinan utuh.

Versi struktur data saat ini: **3** (`schemaVersion`). Versi 2 menambah `applications` dan `skills`; versi 3 menambah `accounts`, `snapshots`, `transactions`, `savingsGoals` dan `settings.financeCategories`. Definisi di kode: `js/schema.js`.

## Dokumen

```json
{
  "app": "louvi",
  "schemaVersion": 3,
  "meta": { "createdAt": "2026-10-08T08:40:00.000Z", "updatedAt": "…" },
  "settings": { "name": "Viony", "theme": "system", "lastExportAt": null, "lastArea": "work" },
  "tasks": [ … ],
  "applications": [ … ],
  "skills": [ … ],
  "accounts": [ … ],
  "snapshots": [ … ],
  "transactions": [ … ],
  "savingsGoals": [ … ],
  "appVersion": "0.3.0",                 // hanya di file backup
  "exportedAt": "2026-10-08T09:00:00Z"   // hanya di file backup
}
```

| Field | Arti |
|---|---|
| `app` | Penanda file louvi. Import menolak file tanpa `"louvi"`. |
| `schemaVersion` | Versi struktur. Data lama di-upgrade otomatis (`js/migrations.js`). Data dari versi *lebih baru* ditolak. |
| `settings.theme` | `system` · `light` · `dark` |
| `settings.lastExportAt` | Kapan terakhir download/copy backup. Dipakai untuk pengingat 14 hari. |
| `settings.lastArea` | Area terakhir dipakai, jadi default saat tambah tugas. |
| `settings._ts` | `{ key: timestamp }` waktu terakhir tiap pengaturan diubah; dipakai saat sync agar pengaturan digabung per kunci. |

## Field wajib di setiap record

| Field | Tipe | Arti |
|---|---|---|
| `id` | string | ID unik (UUID) |
| `createdAt` | ISO timestamp | Waktu dibuat |
| `updatedAt` | ISO timestamp | Waktu terakhir diubah. Nanti dipakai untuk menggabungkan edit dari HP & laptop (Tahap 1d). |
| `deletedAt` | ISO timestamp / `null` | `null` = aktif. Terisi = ada di Trash. |
| `purged` | `true` (opsional) | Sudah dihapus permanen. Record tinggal `id` + tanggal, supaya perangkat lain tahu item ini dihapus. |

Item di Trash dihapus permanen otomatis setelah **30 hari** (dicek saat aplikasi dibuka).

## Task (`tasks[]`)

| Field | Tipe | Nilai |
|---|---|---|
| `title` | string | Wajib, maks. 200 karakter |
| `notes` | string | Maks. 5000 karakter |
| `area` | string | `work` · `thesis` · `career` · `personal` · `plans` |
| `due` | `"YYYY-MM-DD"` / `null` | Tanggal kalender lokal (tanpa jam, jadi tidak bergeser karena zona waktu) |
| `priority` | string | `high` · `normal` · `low` |
| `status` | string | `todo` · `done` |
| `doneAt` | ISO timestamp / `null` | Kapan dicentang selesai |
| `repeat` | object / `null` | Aturan pengulangan, lihat di bawah |
| `links` | array | `[{ "label": "CV", "url": "https://…" }]`, maks. 20, hanya http(s). Data lama tanpa field ini dibaca sebagai `[]`. |
| `nextId` | string / `null` | ID salinan berikutnya yang dibuat saat tugas berulang ini diselesaikan |
| `ref` | object / `null` | `{ "type": "application", "id": "…" }` untuk tugas follow-up milik lamaran |
| `sample` | boolean | `true` untuk tugas contoh (bisa dihapus sekaligus) |

### Aturan pengulangan (`repeat`)

```json
{ "freq": "daily" }
{ "freq": "weekdays" }                    // Senin–Jumat
{ "freq": "weekly", "days": [1, 4] }      // 0 = Minggu … 6 = Sabtu
{ "freq": "monthly", "day": 31 }          // dipotong ke akhir bulan (30 Nov, 28/29 Feb)
```

Cara kerja:
1. Tugas berulang wajib punya `due`.
2. Saat dicentang selesai, louvi membuat salinan baru dengan `due` = tanggal pertama yang cocok **setelah** `due` lama **dan tidak di masa lalu**. Jadi laporan harian yang telat 3 hari tidak menumpuk 3 salinan.
3. Kalau centang dibatalkan dan salinan baru belum disentuh, salinan itu dihapus lagi.
4. Tugas yang sudah selesai tetap tersimpan (tab **Done**) sebagai riwayat.

## Application (`applications[]`)

| Field | Tipe | Nilai |
|---|---|---|
| `company`, `position` | string | Wajib, maks. 120 karakter |
| `location` | string | Maks. 120 |
| `workMode` | string | `""` (belum tahu) · `onsite` · `hybrid` · `remote` |
| `source` | string | Tempat menemukan lowongan, maks. 80 |
| `status` | string | `saved` · `applied` · `screening` · `interview` · `offer` (aktif) · `accepted` · `rejected` · `ghosted` (= No response) · `withdrawn` (selesai) |
| `statusLog` | array | `[{ "status": "applied", "at": "<timestamp>" }]`, maks. 50 entri terakhir |
| `appliedAt` | `"YYYY-MM-DD"` / `null` | Diisi otomatis hari ini saat status pertama kali keluar dari `saved` |
| `salaryMin`, `salaryMax` | integer / `null` | Rupiah per bulan, sesuai yang tertera di lowongan |
| `jobDescription` | string | Maks. 20.000 karakter |
| `requiredSkills` | string[] | Nama skill dari lowongan, maks. 40, tanpa duplikat (tidak peka huruf besar/kecil) |
| `interviews` | array | Lihat di bawah, maks. 30 |
| `notes` | string | Maks. 5000 |
| `links` | array | Sama seperti di Task |
| `followUpTaskId` | string / `null` | Tugas follow-up di `tasks` |

Interview: `{ id, date: "YYYY-MM-DD", time: "HH:MM" atau "", type: hr|user|technical|psych|mcu|final|other, outcome: upcoming|passed|failed, notes }`.

Aturan:
- Follow-up disimpan sebagai **tugas** (area `career`, `ref` ke lamaran), jadi muncul di Today/Upcoming. Mengubah tanggal follow-up di lamaran mengubah tugasnya; mengosongkannya memindahkan tugas ke Trash.
- Saat status berubah ke status selesai, follow-up yang masih terbuka dipindahkan ke Trash (ada Undo).
- "No news for N days": status `applied`/`screening` tanpa perubahan atau interview selama ≥ 30 hari.

## Skill (`skills[]`)

| Field | Tipe | Nilai |
|---|---|---|
| `name` | string | Wajib, unik (tidak peka huruf besar/kecil), maks. 60 |
| `level` | 1–5 | Beginner, Basic, Solid, Strong, Expert (penilaian sendiri) |
| `category` | string | `technical` · `software` · `management` · `soft` · `language` |
| `notes` | string | Bukti/catatan, maks. 1000 |

Perhitungan:
- **Skill match** lamaran = jumlah skill yang diminta dengan level ≥ 3 (Solid) ÷ jumlah skill yang diminta.
- **Worth improving** = skill yang diminta lamaran **aktif** tetapi tidak ada di daftar atau levelnya < 3, diurutkan dari yang paling sering diminta.
- louvi tidak pernah menambahkan skill sendiri; semua skill dan level diisi pengguna.

## Finance

Prinsip: **net worth hanya dihitung dari saldo bulanan** (`snapshots`), bukan dari transaksi. Jadi angkanya tetap benar walaupun ada transaksi yang tidak dicatat. Transaksi hanya menjelaskan arus uang dalam sebulan.

### Account (`accounts[]`)
| Field | Nilai |
|---|---|
| `name` | Wajib, unik (tidak peka huruf besar/kecil), maks. 60 |
| `type` | `bank` · `ewallet` · `cash` · `investment` · `gold` (saldo dalam gram) · `debt` (saldo = sisa utang) |
| `archived` | `true` = tidak muncul di form saldo bulan baru; riwayat tetap |
| `notes` | Maks. 1000 |

### Monthly balances (`snapshots[]`)
| Field | Nilai |
|---|---|
| `month` | `"YYYY-MM"`, satu record per bulan |
| `balances` | `{ "<accountId>": angka }` — rupiah, atau gram untuk akun emas (maks. 4 desimal), atau sisa utang untuk akun debt |
| `goldPrice` | Rupiah per gram yang dipakai bulan itu, atau `null` |
| `note` | Maks. 300 |

Rumus:
- Nilai akun emas = gram × `goldPrice` bulan itu (tidak dihitung jika harga kosong; aplikasi memberi peringatan).
- **Net worth** = Σ aset − Σ utang, untuk akun yang punya saldo di bulan itu.

### Transaction (`transactions[]`)
| Field | Nilai |
|---|---|
| `type` | `income` (Money in) · `expense` (Money out) |
| `date` | `"YYYY-MM-DD"` |
| `amount` | Rupiah, bilangan bulat > 0 |
| `category` | Nama kategori dari `settings.financeCategories` |
| `note` | Maks. 300 |

`settings.financeCategories` = `{ income: ["Salary", …], expense: [{ name, kind: "spend" | "saving" }, …] }`.

Ringkasan per bulan:
- **Money in** = Σ income
- **Spent** = Σ expense dengan kategori `kind: spend`
- **Saved** = Σ expense dengan kategori `kind: saving` (cicilan emas, top-up investasi, transfer tabungan)
- **Left over** = Money in − Spent − Saved

### Savings goal (`savingsGoals[]`)
| Field | Nilai |
|---|---|
| `name` | Wajib, maks. 60 |
| `target` | Rupiah > 0 |
| `targetDate` | `"YYYY-MM-DD"` / `null` |
| `accountIds` | Akun (bukan utang) tempat uang tujuan ini disimpan; minimal 1 |
| `notes` | Maks. 1000 |

Perhitungan (semua **nominal**, tanpa return investasi, perubahan harga emas, atau inflasi):
- **Terkumpul** = nilai akun tertaut pada saldo bulanan terakhir.
- **Butuh per bulan** = (target − terkumpul) ÷ jumlah bulan dari bulan ini sampai bulan tenggat (minimal 1).
- **Laju terkini** = rata-rata perubahan nilai akun tertaut per bulan, dari maksimal 3 bulan terakhir yang tercatat.
- **Status**: Reached · On track (laju ≥ kebutuhan) · Behind pace · Past target date · No deadline · data belum cukup.
- **Perkiraan tercapai** = bulan saldo terakhir + ⌈sisa ÷ laju⌉, hanya jika laju positif. Ini bukan prediksi; gunakan Life Simulator untuk skenario.

## Import

`js/backup.js → parseBackup()` memeriksa file sebelum apa pun diubah:
- bukan JSON / bukan file louvi / dari versi lebih baru → ditolak dengan pesan jelas;
- record tanpa `id` atau `title` → dilewati (jumlahnya ditampilkan);
- field tidak valid (area, tanggal, prioritas, pengulangan) → dikembalikan ke default; link tidak valid dibuang (jumlahnya ditampilkan);
- ID ganda → yang `updatedAt`-nya paling baru dipakai.

Setelah pengguna konfirmasi, data lama disimpan sebagai *automatic backup* (maks. 5 terbaru, di perangkat itu), lalu diganti.

## Sync (`js/sync.js`, `js/lib/merge.js`)

- File di repo: `louvi-data.json` = dokumen yang sama dengan backup (+ `syncedAt`).
- Konfigurasi sync disimpan **per perangkat** di `localStorage['louvi:sync']` (owner, repo, token, nama perangkat, waktu sync terakhir). Tidak pernah masuk dokumen data.
- Langkah sync: simpan lokal → unduh file → validasi & migrasi (seperti import) → gabung → simpan hasil di perangkat → unggah jika berbeda (dengan `sha`; jika GitHub menolak karena ada versi lebih baru, ulangi dari unduh, maks. 4 kali).
- Aturan gabung: per record berdasarkan `updatedAt` (yang lebih baru menang; tanda hapus juga record), settings per kunci berdasarkan `_ts`, `lastExportAt` diambil yang terbaru.
- Restore backup dan Reset menulis ulang `updatedAt` semua record ke waktu sekarang dan menandai record yang tidak ada sebagai terhapus, supaya hasilnya menang saat sync.
- Sebelum sync pertama di sebuah perangkat, louvi membuat automatic backup "Before first sync".

## Penyimpanan di browser

| Urutan | Tempat | Catatan |
|---|---|---|
| 1 | IndexedDB `louvi` (store `doc`, key `main`; store `backups`) | Normal |
| 2 | localStorage `louvi:doc`, `louvi:backups` | Kalau IndexedDB tidak tersedia; hanya 2 backup otomatis |
| 3 | Memori | Storage diblokir; aplikasi menampilkan peringatan merah |

`localStorage['louvi:theme']` hanya cermin pilihan tema supaya tidak ada kedipan warna saat halaman dibuka.

## Menambah field / koleksi baru (untuk developer)
1. Tambah koleksi di `COLLECTIONS` dan normalizer-nya di `NORMALIZERS` (`js/schema.js`).
2. Kalau bentuk data lama berubah: naikkan `SCHEMA_VERSION` dan tambah migrasi di `js/migrations.js`.
3. Tambah test di `tests/tests.js`.
4. Perbarui dokumen ini.

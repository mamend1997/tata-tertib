# SMART TATA TERTIB SISWA

Sistem manajemen kedisiplinan & poin siswa (React + Vite + Tailwind di sisi klien,
server Node.js tanpa framework + SQLite di sisi server).

## Struktur

| Berkas | Isi |
|---|---|
| `server.js` | HTTP server, router mini, sesi cookie, RBAC, API JSON, penyedia berkas statis `dist/`, favicon dari logo sekolah, resolusi tenant per permintaan |
| `saas.js` | **Control plane multi-tenant**: tabel `tenants`/`saas_paket`/`saas_tagihan`/`saas_pembayaran`/`saas_tiket`/`saas_pengumuman`/`saas_audit`/`saas_sesi`/`saas_settings`; provisioning DB sekolah, penagihan otomatis (cron), tiket, backup, WhatsApp, sesi Super Admin |
| `saas-routes.js` | Rute panel Super Admin (`/api/super/...`) + layanan langganan sekolah (`/api/langganan`, `/api/domain`, `/api/tiket`, `/api/panduan`, `/api/legal`) + pendaftaran mandiri `POST /api/daftar` |
| `telegram-backup.js` | Validasi jadwal harian, pengiriman Telegram, zona waktu, dan penyamaran rahasia pada arsip |
| `db.js` | Skema SQLite, seed master data (sekolah, 8 akun, 6 kelas, 17 kategori — tanpa siswa/riwayat contoh), helper poin/status/deteksi dini |
| `doc.js` | Dokumen cetak: kop surat, rekapitulasi poin, surat panggilan & SP 1–3 (A4/F4, `@media print`) |
| `lib.js` | Utilitas: tanggal Indonesia, hash scrypt, ZIP/XLSX writer, normalisasi nomor HP |
| `xlsx-read.js` | Pembaca XLSX/CSV tanpa dependency (untuk import siswa & kelas) |
| `src/` | Aplikasi React (halaman, komponen, tema) |
| `src/components/ImportModal.jsx` | Import Excel generik: siswa, kelas, akun guru (pratinjau + deteksi duplikat) |
| `dev-tests/` | Uji otomatis API, UI (Playwright), cetak PDF, dan publikasi sub-path |

## Perintah

```bash
npm install          # dependency
npm run build        # build React → dist/
node server.js       # jalankan (PORT dari env, default 3000)

node dev-tests/smoke.js    # 56 cek API dasar
node dev-tests/round2.js   # 62 cek API fitur lanjutan (bulk, import akun, profil, tindak lanjut, jurnal, analitik, sanksi, role baru)
node dev-tests/ui.js       # 39 cek UI Playwright
node dev-tests/ui-round2.js# 42 cek UI fitur lanjutan (checkbox bulk, profil, jurnal, analitik, portal mobile)
node dev-tests/print.js    # 12 cek cetak PDF (A4/F4, kop & TTD Kepsek/Wakasek)
node dev-tests/telegram-backup.js # validasi jadwal WIB, idempotensi menit, masking, dan respons Telegram
node dev-tests/round3.js   # 63 cek API ronde 3 (tanpa data dummy, hapus riwayat massal, kotak sampah,
                           # backup/restore JSON, audit data yatim, reset tahun ajaran, kalender, hak akses,
                           # endpoint data contoh 404, ukuran font kop per baris ikut tercetak)
node dev-tests/ui-round3.js# 37 cek UI ronde 3 (kalender, baris deteksi dini clickable, kotak sampah,
                           # tab backup/reset, data contoh hilang, form kop interaktif, audit tersembunyi,
                           # siswa baru bersih, mobile)
node dev-tests/kategori.js # 29 cek API import Kategori Poin: template Excel, pratinjau (jenis/poin/duplikat),
                           # commit idempoten, CSV, validasi berkas, hak akses
node dev-tests/ui-kategori.js # 22 cek Playwright: masuk dashboard Super Admin (2 jalur) +
                           # import Kategori Poin lewat UI (unduh template, unggah, pratinjau, simpan)
node dev-tests/saas.js     # 136 cek API SaaS: login Super Admin, dashboard 3 metrik, tambah sekolah + kode
                           # 4 digit, kelas otomatis per jenjang, kontrol fitur per paket, reset sandi,
                           # Login as Tenant, paket CRUD, pembayaran + verifikasi + cron idempoten,
                           # suspend otomatis, tiket dua arah, pengumuman & maintenance, panduan, legal,
                           # branding, QRIS + promo, menu default, audit, WA, backup ZIP/SQL/source/restore,
                           # database manager, pendaftaran mandiri, domain custom, batas akses, isolasi data
node dev-tests/ui-saas.js  # 95 cek Playwright: tombol "Daftarkan Sekolah" + form + auto login, menu akun
                           # (Info & Layanan/Pusat Bantuan/Petunjuk/Legal), 15 menu panel Super Admin,
                           # detail sekolah bertab, verifikasi pembayaran, cron, pengaturan platform,
                           # database manager, mobile 390px, tanpa error JS
node dev-tests/kop.js      # 25 cek kop surat: teks dicetak apa adanya (tanpa KAPITAL paksa),
                           # ukuran logo lebar/tinggi + validasi, migrasi kop manual lama, tersimpan & terbaca ulang
node dev-tests/ui-kop.js   # 22 cek UI Playwright: teks kop dapat diketik, ukuran font per baris,
                           # ukuran logo pada pratinjau, simpan + muat ulang, mobile 390px
node dev-tests/base.js     # 7 cek publikasi sub-path (proxy meniru platform)
```

## Data awal

Instalasi baru **hanya** berisi master data (identitas sekolah, akun, kelas, kategori poin, tahun pelajaran).
Tidak ada siswa/riwayat contoh otomatis — setiap siswa baru benar-benar bersih. Fitur pembuat data
dummy ("Data Contoh") sudah **dihapus** dari aplikasi: tidak ada menu, tombol, maupun endpoint yang
dapat memuat data contoh ke dalam sistem.

Menu tambahan: **Kotak Sampah** (restore/hapus permanen, retensi 30 hari), **Kalender Disiplin**, dan di
Pengaturan: **Backup & Restore (.json)**, **Reset Tahun Ajaran**, dan tautan ke halaman
**Audit Data Tersembunyi** (khusus Administrator, tidak tampil di navigasi).
Backup Telegram dapat diatur terpisah pada setiap sekolah dan Super Admin, dengan beberapa jam harian
(zona waktu aplikasi), uji koneksi, dan pengiriman manual. Arsip adalah cadangan satu arah, bukan sinkronisasi
dua arah; token bot dan kunci layanan tidak disertakan dalam arsip.

## Multi-tenant (SaaS)

Satu pemasangan aplikasi melayani banyak sekolah:

* **Super Admin platform** — buka `#/saas` (mis. `/tata-tertib/#/saas`) atau klik tautan
  **Panel Super Admin** di bawah form login. Akun bawaan `superadmin` / `superadmin123`
  (ubah lewat env `SAAS_ADMIN_USER` / `SAAS_ADMIN_PASS`). Akun Super Admin yang dimasukkan pada
  form login sekolah otomatis diarahkan ke panel platform (tidak memakai panel sekolah).
  15 menu: Dashboard, Daftar Sekolah, Pembayaran & Penagihan, Paket Langganan, Default Menu,
  Branding, QRIS & Harga, Syarat & SLA, Pusat Tiket, Pengumuman & Maintenance, Petunjuk Pengguna,
  Audit Logs, WhatsApp Gateway, Backup & Restore, Database Manager.
* **Database terpisah per sekolah** — `data/saas.sqlite` (control plane) + `data/sekolah/<kode>-<slug>.sqlite`.
  Berkas DB sekolah pertama (data lama) otomatis dijadikan tenant **Lifetime**.
* **Pendaftaran mandiri** — tombol *Daftarkan Sekolah* di halaman login, masa uji coba 7 hari,
  kelas bawaan otomatis mengikuti jenjang (SD I–VI, SMP VII–IX, SMA/SMK X–XII, dst.), langsung masuk dashboard.
* **Panel sekolah** mendapat menu **Info & Layanan** (paket, tanggal register, tagihan, masa aktif,
  tombol Perpanjang + QRIS/instruksi), **Pusat Bantuan** (tiket dua arah), **Petunjuk Pengguna**, **Legal & SLA**.

Variabel lingkungan baru: `SAAS_DB_PATH` (control plane), `SAAS_ADMIN_USER`, `SAAS_ADMIN_PASS`,
`SAAS_ADMIN_EMAIL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `WA_API_URL`, `WA_API_TOKEN`, `APP_BASE_URL`.
Bila `DB_PATH` diarahkan ke tempat lain (mis. saat pengujian), control plane & folder database sekolah
otomatis ikut ke folder tersebut supaya data produksi tidak tersentuh.

### AI Tutorial edupoin

Widget bantuan sekolah memakai endpoint AI yang kompatibel dengan OpenAI. Atur variabel berikut pada
Railway Variables; API key hanya dibaca server dan tidak pernah dikirim ke browser:

| Variabel | Nilai |
|---|---|
| `EDUPOIN_AI_API_KEY` | API key penyedia AI |
| `EDUPOIN_AI_BASE_URL` | Opsional; default `https://api.openai.com/v1` |
| `EDUPOIN_AI_MODEL` | Opsional; default `gpt-4o-mini` |

Endpoint publik harus menggunakan HTTPS; HTTP hanya diizinkan untuk `localhost` saat pengembangan.
Chat mengirim pertanyaan dan dokumentasi FAQ yang relevan saja, bukan database tenant atau data siswa.
Target tombol yang dapat disorot dibatasi ke daftar dokumentasi dan izin role pengguna. Tanpa API key,
widget tetap memberi tahu bahwa layanan belum dikonfigurasi.

### Deploy di Railway

SQLite harus disimpan pada **Railway Volume** agar akun dan data tidak hilang saat deploy ulang.
Buat Volume dan mount pada service aplikasi; ketika `RAILWAY_VOLUME_MOUNT_PATH` tersedia,
aplikasi otomatis menaruh `tata-tertib.sqlite`, `saas.sqlite`, serta database tiap sekolah di sana.
Jika menetapkan `DB_PATH` atau `SAAS_DB_PATH` sendiri, arahkan keduanya ke Volume tersebut.

Pada instalasi baru, halaman login akan mengisi otomatis kode sekolah bila hanya ada satu sekolah.
Untuk beberapa sekolah, pilih kode dari saran pada kolom Kode Sekolah. Akun administrator awal
adalah `admin` dengan kata sandi `admin123`; segera ubah kata sandi setelah berhasil masuk.

## Import data dari Excel

Tersedia di beberapa modul (tombol **Template Excel** + **Import**):

| Modul | Template | Kolom |
|---|---|---|
| Data Siswa | `/api/siswa-template.xlsx` | NAMA, NIS, NISN, KELAS, JK, TGL LAHIR, NO HP |
| Data Kelas | `/api/kelas-template.xlsx` | NAMA KELAS, TINGKAT, JURUSAN, WALI KELAS |
| Akun Pengguna | `/api/users-template.xlsx` | NAMA, JABATAN, USERNAME, ROLE, NIP, NO HP, KATA SANDI |
| **Kategori Poin** | `/api/kategori-template.xlsx` | NAMA KATEGORI, JENIS (Pelanggaran/Prestasi), POIN, KETERANGAN |

Alur semua import sama: unduh template → unggah berkas (xlsx/csv) → **pratinjau** dengan validasi &
deteksi duplikat → **Simpan** (hanya baris valid; baris ganda/error dilewati). Import Kategori Poin
idempoten: mengulang import berkas yang sama tidak membuat kategori dobel.

## Akun contoh (ubah di menu Akun Pengguna)

| Role | Username | Sandi |
|---|---|---|
| Administrator | `admin` | `admin123` |
| Kepala Sekolah | `kepsek` | `kepsek123` |
| Guru BK | `bk` | `bk12345` |
| Guru Kesiswaan | `kesiswaan` | `kesiswaan123` |
| Wali Kelas | `wali1` / `wali2` / `wali3` | `wali123` |
| Guru Mata Pelajaran | `guru` | `guru123` |
| Guru Umum (piket) | `guruumum` | `guruumum123` |
| Tenaga Administrasi (TU) | `tu` | `tu123456` |

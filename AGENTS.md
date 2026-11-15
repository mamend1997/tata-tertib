
---

## Ronde 5 — tenant baru tanpa akun bawaan, akordeon eksklusif, sidebar hover

- `saas.createTenant()` menghapus semua akun contoh (`DELETE FROM users WHERE id<>?`) → tenant baru hanya 1 akun admin.
- `src/App.jsx`: `openGroups` (null = semua terbuka). Klik judul grup → **eksklusif** (`[grup]`); klik grup yang
  sedang terbuka → semua terlipat. `localStorage stt:nav-groups`.
- Sidebar: tombol lipat (`PanelLeftClose/PanelLeftOpen`, `stt:nav-collapsed`), fly-out `stt:nav-hover`
  (panel `lg:absolute lg:z-[60]`, `aside` `lg:relative lg:z-50` agar tidak tertutup konten).
- Test: `node dev-tests/round5.js` (25 cek). `ui-round4.js` memakai selector `main input` (checkbox baru di sidebar).

---

## Ronde 16 — integrasi Kasera Pay (transaksi + webhook bertanda tangan)

- `payment.js`: `KASERA` + `kaseraCfg/kaseraSecrets/kaseraCreateTransaction/kaseraCheckTransaction/
  kaseraVerifySignature/kaseraEvent/kaseraPayload`. Endpoint resmi **`POST {base}/v1/transactions`**
  (header `Authorization: Bearer`, **`Idempotency-Key`** = nomor pesanan, `Accept`/`Content-Type` JSON;
  body `amount` integer, `external_id`, `description`, `payment_methods:["qris"]` → `checkout_url`.
  Base resmi test maupun live `https://pay.kasera.id`; mode ditentukan prefix key `kp_test_`/`kp_live_`
  (env `KASERA_BASE_URL` dapat mengganti host).
- Mode `auto` memakai `/v1/qris` hanya bila endpoint transaksi mengembalikan 404/405/501; pilihan `qris`
  memaksa API lama. Timeout atau respons 2xx tanpa checkout/QR tidak di-fallback karena request pertama
  mungkin sudah membuat tagihan. 401/422 juga tidak di-fallback. Mode API dapat dikunci lewat setting
  `pay_gateway_kasera_api` = `auto|transactions|qris`.
- **Webhook `POST /api/webhook/kasera`** (`saas-routes.js`, opt `{saas:true}`, TANPA sesi):
  header `Kasera-Signature-V1` = HMAC-SHA256(timestamp + "." + **body mentah**, secret), toleransi 5 menit
  — `readRaw(req)` diteruskan server.js → saas-routes (`rawBodyOf`); header legacy `Kasera-Signature`
  tetap diterima. Tanpa secret → **503**, tanda tangan salah → **401**.
- `saas.kaseraHandleWebhook()`: deduplikasi tabel **`kasera_event`** (`event_id` PRIMARY KEY, hasil
  `ok|diabaikan|tidak-ditemukan|jumlah-tidak-cocok|gagal`), `payment.paid` → `external_id` →
  `gatewayMarkPaid` (perpanjangan otomatis + audit `WEBHOOK KASERA`). Nominal event < tagihan → 400.
- Rute CSRF-exempt: konstanta `CSRF_EXEMPT` di `server.js` (berisi `/api/webhook/kasera`, `/api/pay/callback`,
  `/api/super/login`, `/api/login`).
- `payConfig()` kini mengirim `webhook_url`, `kasera_api`, `webhook_secret_set`; `GET /api/super/qris`
  **menyamarkan** `pay_gateway_key/key2/callback` di `s` dan mengirim `pay.events` (8 log terakhir).
- UI: `SuperBilling.jsx` → kartu **Kasera Pay — Transaksi & Webhook Otomatis** (`[data-pay-kasera-api]`,
  `[data-pay-callback]`, `[data-pay-webhook]`, tabel `[data-tbl="kasera-event"]`); `Langganan.jsx`
  menampilkan tombol **Buka Halaman Pembayaran** (`[data-checkout-url]`) bila gateway mengembalikan `checkout_url`.
  **Wajib `npx vite build`** setelah mengubah `src/`.
- Tes: `node dev-tests/round16.js` (55 cek). Regresi lulus: `round15` (72), `round13` (41), `smoke` (58),
  `round2` (62) — jalankan `smoke`/`round2` dengan `DEMO_SEED=1`; `round13` **harus sendirian**
  (DB control plane di `/tmp/saas.sqlite` dipakai bersama bila beberapa tes dijalankan berurutan).

---

## Ronde 17 — Jadwal Pelajaran, Absensi Guru Mapel, Absensi Siswa per Mapel (QR), Rekap WA, multi-role

### Berkas baru
| Berkas | Isi |
|---|---|
| `akademik.js` | Semua route akademik (dipasang `server.js` lewat `require('./akademik')(api)`): pengaturan jadwal, mapel, slot & drag-drop, impor/ekspor/cetak, tautan publik, absensi guru, absensi siswa, presensi publik, scheduler WA |
| `src/pages/Jadwal.jsx` | Matriks jadwal (drag & drop), tab Mata Pelajaran & Pengaturan, modal impor & tautan publik |
| `src/pages/AbsensiGuru.jsx` | Kartu jadwal hari ini + form absensi (time lock, jurnal, foto), rekap & kirim WA |
| `src/pages/AbsensiSiswa.jsx` | Sesi presensi hari ini, editor presensi, QR & tautan, rekap per siswa |
| `src/components/AbsensiKelas.jsx` | Editor presensi H/S/I/A/B (dipakai panel guru **dan** halaman publik) |
| `src/pages/PresensiSiswa.jsx` · `src/pages/JadwalPublik.jsx` | Halaman publik tanpa login: `/presensi/<token>` & `/jadwal-publik/<token>` |
| `dev-tests/akademik.js` (100) · `dev-tests/ui-akademik.js` (45) | Uji API & UI ronde ini |

### Tabel & kolom baru (migrasi otomatis)
`mapel` (+`max_jam_hari`), `guru_mapel`, `jadwal`, `absensi_sesi`, `absensi_guru`, `absensi_siswa`, `jadwal_publik`,
`users.roles` (JSON multi-role). Setting baru: `jadwal_hari`, `jadwal_max_jam`, `jadwal_sesi` (JSON, termasuk istirahat),
`jadwal_max_mapel_jam`, `jadwal_max_guru_jam`, `jadwal_publik_token/aktif`, `absensi_buka_menit`, `absensi_tutup_menit`,
`absensi_jurnal_min`, `absensi_foto_wajib`, `absensi_foto_hari` (default 90), `absensi_siswa_aktif`,
`absensi_siswa_tutup_menit`, `kepsek_wa`, `wakasek_kur_wa`, `absensi_wa_aktif`, `absensi_wa_jam`, `absensi_wa_terakhir`.

### Aturan penting
- **Role baru `wakasek_kurikulum`** + `users.roles` (JSON) → `dbm.userRoleList/roleLabelOf/permsFor`; `can()` menggabungkan izin SEMUA role. Bootstrap memakai `permsFor`, bukan `permissionMatrix()[role]`.
- **`seedPermissions()`** dipanggil `seed()` **dan** `migrateConn()` → DB sekolah lama otomatis mendapat baris izin untuk role/fitur baru (INSERT OR IGNORE, tidak menimpa pengaturan manual). Paket & `tenants.fitur_override` eksplisit ikut ditambah `jadwal/absensi_guru/absensi_siswa` di `saas.init()`.
- **Konflik jadwal**: KERAS (409, tidak bisa diabaikan) = kelas dobel, guru mengajar 2 kelas pada jam sama, sesi istirahat/hari nonaktif. LUNAK (409 `butuh_konfirmasi`, kirim ulang `abaikan:1`) = lewat batas jam mapel/guru per hari, ruang dobel.
- **Time lock absensi guru**: hanya slot milik guru tsb, hanya HARI INI, hari jadwal harus cocok, jam submit di `[mulai − absensi_buka_menit, selesai + absensi_tutup_menit]`, satu baris per (jadwal,tanggal) → setelah jendela tutup tidak dapat diubah. Admin/wakasek boleh mencatat atas nama guru (tetap dalam jendela), diaudit.
- **Bukti foto absensi**: dikompres WebP di klien, diunggah lewat `uploadBuffer` (`jenis='absensi'`), `absensiPurgeFoto()` menghapus berkas + mengosongkan `foto_url` setelah `absensi_foto_hari` (scheduler 6 jam).
- **Presensi siswa**: token sesi `<kode>.<ps>.<acak>`; `/api/public/presensi/:token` menentukan tenant dari prefix token (lihat `server.js`). Jendela publik memakai `absensi_siswa_tutup_menit`; wajib nama pencatat ≥3 karakter; status hanya `H/S/I/A/B`; siswa divalidasi milik kelas slot.
- **QR**: `qrcode` (npm, dependency baru) → SVG untuk tampilan + PNG data-URL untuk unduh.
- **Rekap WA**: `POST /api/absensi-guru/rekap-wa` (manual) & scheduler `checkWaRekap()` per tenant setiap 60 detik setelah `absensi_wa_jam`, sekali per tanggal (`absensi_wa_terakhir`), butuh gateway aktif + minimal satu nomor. Log masuk `wa_log` (`jenis='rekap-absensi-guru'`).
- **Route cetak** `/api/jadwal/cetak` memakai `doc.kop()` → `doc.js` kini mengekspor `kop` & `kopLines`.

### Gotcha
- `jamMenit()` di db.js memakai regex dengan **dua grup** (`HH` & `MM`); jangan hapus grup menit.
- Komponen form yang memakai state awal `{}` harus defensif: `(f.kelas_ids || [])` — pernah membuat halaman blank (`undefined.includes`).
- Playwright dibatasi 1 tab per browser instance → `dev-tests/ui-akademik.js` menutup page sebelum membuka page berikutnya.
- `selectOption({label})` di Playwright versi ini **tidak menerima RegExp** — pakai teks persis.

---

## Ronde 18 — poin otomatis absensi, rekap absensi (guru/siswa/peringkat), WA wali kelas, Kanal Aduan Kekerasan, Program Layanan BK, Asesmen BK

### Berkas baru
| Berkas | Isi |
|---|---|
| `rekap.js` | Rekap absensi guru & siswa (semua periode), peringkat I/S/A/B, ekspor Excel + halaman cetak, pengaturan & scheduler WA wali kelas |
| `bk.js` | Kanal Aduan Kekerasan + QR, Program Layanan BK + cetak, Asesmen BK (4 instrumen), bank soal + import/template, analisis AKPD/RIASEC/Gaya/Kesulitan |
| `printdoc.js` | Halaman cetak generik (kop dinamis `doc.kop`, tombol Cetak/Simpan PDF) untuk laporan rekap, layanan BK, dan hasil asesmen |
| `src/pages/RekapAbsensiGuru.jsx` · `RekapAbsensiSiswa.jsx` · `PengaturanRekap.jsx` | UI rekap + tab pengaturan WA (juga dipasang di Pengaturan) |
| `src/pages/KanalAduan.jsx` · `ProgramBK.jsx` · `AsesmenBK.jsx` · `AsesmenSoal.jsx` | Panel BK untuk guru/BK |
| `src/pages/AduanPublik.jsx` · `AsesmenPublik.jsx` | Halaman publik `/aduan/<token>` & `/asesmen/<token>` (tanpa login) |
| `dev-tests/bk.js` (96) · `ui-bk.js` (57) · `rekap-scheduler.js` (8) | Uji API, UI, dan scheduler WA |

### Tabel, kolom & setting baru (migrasi otomatis)
- Tabel: `aduan`, `bk_jenis`, `bk_layanan`, `asesmen_instrumen`, `asesmen_soal`, `asesmen_hasil`
  (semua masuk `BACKUP_TABLES`; `bk_layanan` masuk `TRASH_TABEL`).
- Kolom: `kategori.auto_key` (+ unique parsial), `kejadian.sumber` & `kejadian.ref_id` (+ unique parsial),
  `users.aduan_token`, `users.aduan_token_at`, `users.aduan_keswa`, `users.aduan_ppa`.
- Setting: `absensi_auto_poin`, `absensi_poin_alfa` (5), `absensi_poin_bolos` (10),
  `absensi_wa_kelas_aktif`, `absensi_wa_kelas_jam` (15:00), `absensi_wa_kelas_hari` (1–5),
  `absensi_wa_kelas_terakhir`, `bk_ttd_nama/nip/jabatan/guru_nama`.
- `BK_SCHEMA_SQL` dijalankan ulang di `runMigrations()` karena `applySchema()` hanya berjalan pada DB baru.
- Fitur baru: `rekap_absensi_guru`, `rekap_absensi_siswa`, `bk_layanan`, `asesmen`, `asesmen_soal`, `aduan`
  (nav grup **Akademik** & **Bimbingan Konseling**). Izin default ditambahkan di `DEFAULT_PERMS`;
  `seedPermissions()` (INSERT OR IGNORE) membuat barisnya otomatis pada DB sekolah lama.
  Paket `basic`/`premium` + `fitur_override` tenant ditambah lewat migrasi `BARU` di `saas.init()`.

### 1. Poin otomatis dari absensi
- `dbm.absensiPoinSync(sesi, pencatat, role, userId)` dipanggil di akhir `simpanPresensi()` (akademik.js) untuk
  SEMUA jalur: guru pengampu, wali kelas, admin/wakasek, dan ketua kelas lewat tautan/QR publik.
- Sumber bobot = **Master Kategori Poin** (baris `auto_key='absensi_alfa'` / `'absensi_bolos'`, bawaan 5 & 10 poin).
  Admin mengubah poin di `/kategori`; kategori otomatis **tidak dapat dihapus** dan jenisnya harus tetap pelanggaran.
- Satu baris `absensi_siswa` = satu `kejadian` (`sumber='absensi'`, `ref_id=absensi_siswa.id`). Status dikoreksi
  menjadi H/S/I → catatan otomatis dihapus. Poin & kategori diperbarui saat presensi disimpan ulang.
- Keterangan: `Otomatis dari Absensi <Mapel> tanggal <tanggal panjang> - Status: Alpha|Bolos · Kelas … · Pencatat: <nama>`.
- UI: banner bobot poin di halaman **Absensi Siswa per Mapel**; toast `AbsensiKelas` menampilkan jumlah catatan poin.

### 2. Rekap absensi
- `GET /api/rekap/absensi-guru` — periode `harian|mingguan|bulanan|tahun|custom`, filter `guru`, `mapel`.
  Rekap per guru (H/I/S/A/belum, total jam, % hadir, jumlah jurnal) + rincian jurnal mengajar.
  Rincian dibatasi 4.000 baris (`truncated`), ringkasan tetap dari seluruh data.
- `GET /api/rekap/absensi-siswa` — `mode=kelas|siswa`, filter `kelas`, `siswa`, `q`, `mapel`, periode.
  Mode kelas menampilkan seluruh siswa aktif kelas (termasuk yang belum punya catatan).
- `GET /api/rekap/ranking` — 4 daftar top 10: izin, sakit, alfa, bolos.
- Ekspor/cetak: `/api/rekap/absensi-guru/export|cetak`, `/api/rekap/absensi-siswa/export|cetak`.
- Halaman: `#/rekap_absensi_guru`, `#/rekap_absensi_siswa` (tab per kelas / per siswa / peringkat / WhatsApp).

### 3. WhatsApp rekap harian ke Wali Kelas
- Pemetaan nomor: `kelas.wali_id` → `users.phone` (ditampilkan di tab pengaturan, peringatan bila kosong).
- Pesan memuat ringkasan H/S/I/A/B, daftar nama per status, dan rincian per mata pelajaran per status.
- Scheduler `rekapMod.checkWaKelas()` dipanggil server setiap 60 detik untuk SEMUA tenant; mengirim hanya bila
  `absensi_wa_kelas_aktif=1`, gateway aktif, hari termasuk `absensi_wa_kelas_hari`, jam ≥ `absensi_wa_kelas_jam`,
  dan `absensi_wa_kelas_terakhir ≠ hari ini` (anti dobel). Kirim manual seluruh kelas juga menandai tanggal tsb.
- Tanpa gateway, `POST /api/rekap-absensi/wa/kirim` mengembalikan daftar tautan `wa.me`.
- Pengaturan tersedia di **Pengaturan → Rekap Absensi & WA** dan di tab WhatsApp halaman Rekap Absensi Siswa.

### 4. Kanal Aduan Kekerasan
- Token per guru/BK: `<kode>.<aduan>.<hex>` di `users.aduan_token`; alamat publik `/aduan/<token>`.
  Generate otomatis saat panel dibuka; **Reset QR** membuat token baru (token lama 404).
- `POST /api/public/aduan/:token` memverifikasi **nama + kelas + tanggal lahir** terhadap data siswa; aduan hanya
  dapat dibaca pemilik kanal (`WHERE guru_id = user.id`, termasuk ekspor Excel).
- Panel: QR (SVG/PNG) + tautan, Bagikan Gambar QR (`navigator.share`, fallback unduh), Unduh, Salin, Reset;
  nomor layanan kesehatan jiwa & Unit PPA (tampil di halaman siswa); daftar **Aduan Masuk** dengan tab status +
  penghitung, pencarian, detail, status (`baru|diproses|selesai`) + catatan tindak lanjut, ekspor `.xlsx`.
- Server tenant halaman publik ditentukan dari prefix kode sekolah pada token (`server.js` regex
  `/api/public/(presensi|jadwal|aduan|asesmen)/…`).

### 5. Program Layanan BK
- `bk_jenis` (13 jenis bawaan, kategori `dasar|individual|responsif`, `sasaran` kelas/siswa/keduanya, dapat diedit,
  nonaktif, atau dihapus bila belum dipakai) + `bk_layanan` (sasaran kelas & siswa JSON, foto bukti via media proxy).
- Form: jenis (optgroup per kategori), sasaran dinamis (kelas multi / siswa multi `MultiStudentPicker`), topik, tujuan,
  uraian, hasil, tindak lanjut, tempat, jam, foto. Cetak `/api/bk/layanan/:id/cetak` (kop + TTD Kepala Sekolah &
  Koordinator BK dari setting `bk_ttd_*`). Export Excel `/api/bk/layanan/export`.
- Hapus = `trashAdd('bk_layanan')` (restore lewat Kotak Sampah).

### 6. Asesmen Siswa BK
- 4 instrumen: `akpd` (Likert 1–4, 28 butir), `riasec` (42, kategori R/I/A/S/E/C), `gaya` (15, visual/auditorial/
  kinestetik), `kesulitan` (15, internal/eksternal). Bank soal awal di-seed `ASESMEN_DEFAULT` (`db.js`).
- Tautan publik per instrumen `/<asesmen>/<kode>.<hex>`; QR dari `qrcode`; aktif/nonaktif/reset.
- Pengisian satu kali: verifikasi **NISN (atau NIS) + nama lengkap**, unique index `(kode, siswa_id)`; submit kedua 409.
  Jawaban & skor disimpan sebagai snapshot → mengubah bank soal (versi naik) **tidak** mengubah hasil lama.
- Skor: AKPD `dim[kategori] = {sum,count}` → `IR = sum/(count×4)×100`, prioritas bidang diurutkan IR, proporsi
  alokasi = IR/ΣIR×100; daftar kebutuhan (butir skor ≥3), kelompok bermasalah (rata-rata IR ≥70%), draf
  Protah/Prosem otomatis per bidang. RIASEC/Gaya = persentase per kategori (sum/count×100), kode Holland 3 teratas,
  rekomendasi karier/pembelajaran. Kesulitan = persentase internal vs eksternal + rekomendasi konseling individual/
  kelompok/rujukan.
- Analisis per kelas + seluruh sekolah; ekspor Excel & cetak PDF (`/api/asesmen/export|cetak?kode=&kelas=`).
- Bank soal: tambah/edit/hapus/aktif-nonaktif, kategori wajib sesuai instrumen, template Excel & import
  (mode tambah/ganti), tombol **Simpan & Perbarui Bank Soal** menaikkan versi.

### Gotcha penting
- **Urutan seed**: `migrateConn()` hanya memanggil `seedFiturBaru()` bila `settings.seed_version` sudah ada.
  DB baru harus lewat `seed()` agar 17 kategori bawaan dibuat DULU, baru kategori otomatis absensi.
  (Tanpa ini, instalasi baru hanya memiliki 2 kategori.)
- **Index unik parsial** `kejadian(sumber, ref_id)` & `kategori(auto_key)` wajib memakai `WHERE … IS NOT NULL`;
  tanpa itu baris lama dengan NULL dianggap duplikat.
- `delete kategori` menolak baris `auto_key` (single & masal) — ubah poinnya saja.
- Halaman publik memakai token ber-prefix kode sekolah; jangan mengubah format token tanpa memperbarui regex
  `mTok` di `server.js` dan pemetaan tenant `/api/public/...`.
- `printdoc.page()` memakai kop dinamis `doc.kop()`; teks judul di HTML tidak di-uppercase oleh CSS, jadi regex
  pengujian cetak harus case-insensitive.
- Tes UI: `dist/` harus dibangun ulang (`npx vite build`) setiap kali `src/` berubah; tes menyiapkan data presensi
  lewat API dengan jam WIB (server TZ Asia/Jakarta) agar rekap & peringkat berisi.
- `ui-bk.js` memakai satu tab Playwright; navigasi dilakukan berurutan tanpa membuka tab kedua.

### Tes
```bash
node dev-tests/bk.js               # 96 cek API: poin otomatis (buat/ubah/hapus), kategori otomatis,
                                   # rekap guru/siswa/peringkat + ekspor/cetak, pengaturan & pratinjau WA,
                                   # aduan (QR, publik, verifikasi DOB, status, reset token), layanan BK + cetak,
                                   # asesmen (4 instrumen, sekali isi, analisis AKPD/RIASEC/gaya, versi soal), RBAC
node dev-tests/ui-bk.js            # 57 cek Playwright: semua halaman baru, modal & filter, halaman publik,
                                   # mobile 390px tanpa overflow, tanpa error JS
node dev-tests/rekap-scheduler.js  # 8 cek: scheduler WA mengirim sekali/hari, isi pesan, berhenti bila nonaktif
```
Regresi yang dijalankan & lulus: `smoke` (58, DEMO_SEED), `round2` (62, DEMO_SEED), `round3` (63), `round4` (63),
`round5` (25), `round9` (59), `round10` (30), `round11` (44), `round12` (50), `round14` (30), `round15` (72),
`round16` (42), `kelas-ta` (37), `kategori` (29), `saas` (136), `akademik` (100), `ui-akademik` (45),
`ui-round2` (42).

### Status live setelah ronde 18
- Bundle aktif `assets/index-ChbYaK5u.js`; halaman `/`, `/daftar`, `/super-admin`, portal
  `/smk-pgri-cikoneng/portal-siswa` = 200; `/portal` & `/portal-siswa` tetap 404 sesuai aturan lama.
- Migrasi sudah berjalan di kedua sekolah live: `1525 SMK PGRI CIKONENG` (73 kategori, 2 kategori otomatis,
  100 butir asesmen, 13 jenis layanan BK) dan `2290 SMAN 1 Panumbangan` (kategori otomatis + bank soal + jenis BK
  terisi saat database sekolah itu pertama kali dibuka).
- Endpoint publik baru aktif: `/api/public/aduan/<token>` (404 untuk token salah, JSON), `/api/public/asesmen/<token>`;
  halaman SPA `/aduan/<token>` & `/asesmen/<token>` menyajikan aplikasi dengan `<base href="/tata-tertib/">`.
- `features` pada `/api/bootstrap` sudah memuat `rekap_absensi_guru`, `rekap_absensi_siswa`, `bk_layanan`,
  `asesmen`, `asesmen_soal`, `aduan`. Kata sandi akun sekolah **tidak diubah** oleh ronde ini.

---

## Ronde 20 — identitas asesmen (Nama + Tanggal Lahir), hapus massal aduan/hasil, fix blank & QR, rekap per mapel, jadwal, check-in guru

### 1. Asesmen publik: Nama + Tanggal Lahir (bukan NISN) + autocomplete
- `src/components/SiswaAutocomplete.jsx` (baru) — input nama dengan **dropdown real-time mulai 3 huruf**
  (debounce 250 ms, navigasi panah/Enter, chip "terpilih" + kelas otomatis). Dipakai halaman **asesmen** & **aduan**.
- Endpoint pencarian publik: `GET /api/public/asesmen/:token/siswa?q=` dan `GET /api/public/aduan/:token/siswa?q=`
  → `[{id,nama,kelas_id,kelas_nama}]`; **tanggal lahir tidak pernah dikirim ke klien** (hanya diverifikasi server).
- `bk.js`: `identitasSiswa(body)` — verifikasi **siswa_id + tanggal_lahir** (jalur baru) atau `nama+kelas_id+DOB`;
  jalur lama `nisn+nama` tetap diterima (kompatibilitas). DOB wajib; DOB tidak cocok → 403; DOB siswa kosong → 400.
- `POST /api/public/asesmen/:token/cek|submit` & `POST /api/public/aduan/:token` menerima `siswa_id`.
  Halaman aduan **menyembunyikan pilihan Kelas** begitu siswa dipilih (kelas diambil dari database) dan
  menampilkan `[data-aduan-kelas-auto]`; tanggal lahir tetap wajib.

### 2. Hapus massal (ceklis + Pilih Semua + konfirmasi)
- `POST /api/aduan/delete` (`ids[]`, hanya aduan milik kanal sendiri) → panel **Aduan Masuk**: ceklis per baris
  (`[data-aduan-item]`), Pilih Semua (`[data-aduan-all]`), penghitung, **Hapus Terpilih**, plus hapus per baris.
- `POST /api/asesmen/hasil/delete` (`ids[]`) → tab **Daftar Responden**: ceklis (`[data-hasil-item]`),
  Pilih Semua (`[data-hasil-all]`), **Hapus Riwayat Asesmen Terpilih**; siswa dapat mengisi ulang setelah dihapus.

### 3. Bug halaman blank (gaya/kesulitan/RIASEC) & tata letak QR asesmen
- **Penyebab blank**: bentuk respons analisis berbeda per instrumen (AKPD memakai `bidang`, instrumen lain
  `distribusi`). Saat pengguna berpindah instrumen cepat, respons lama masih terpasang → `k.distribusi[0]` /
  `s.bidang.map` melempar error dan React mengosongkan halaman.
- **Perbaikan**: `AsesmenBK` hanya memakai analisis dengan `analisis.kode === kode` (`analisisAktif`), semua akses
  diberi fallback `(x || [])`, dan `kelasAnalisis` disiapkan per mode. Pilihan ceklis direset saat kode/kelas berubah.
- **QR asesmen**: struktur disamakan dengan Kanal Aduan — kotak `h-[188px] w-[188px]` `overflow-hidden` +
  `<div class="h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full">` sehingga SVG 260 px tidak meluber
  dan tidak menimpa kotak tautan di sampingnya (`[data-qr-asesmen]`).

### 4. Rekap absensi per mapel — `no such column: s.kelas_id` (diperbaiki)
- `GET /api/absensi-siswa/rekap` memakai alias `s` = **absensi_sesi** yang menyimpan `kelas_ids` (jamak), bukan
  `kelas_id`. Filter kelas kini memakai `COALESCE(a.kelas_id, sd.kelas_id)`, filter mapel `COALESCE(s.mapel_id,j.mapel_id)`,
  dan TA `COALESCE(j.ta_id,s.ta_id)`; kelas siswa diambil lewat join `kelas` pada kolom yang sama.
  Rekap per kelas / mapel / keduanya + rentang tanggal kembali normal.

### 5. Jadwal: portal publik & matriks
- `JadwalPublik.jsx`: `main` tidak lagi memakai `-mt-5` (penyebab kartu filter menimpa header); ditambah kartu
  **Bagikan jadwal** (Barcode/QR, Salin Tautan, Unduh QR) memakai `GET /api/public/jadwal/:token/qr`.
- Panel jadwal: `GET /api/jadwal/publik/qr` (auth) mengembalikan SVG+PNG; modal **Tautan Publik** menampilkan QR +
  Unduh Barcode.
- Matriks: kelas terpilih di-reset ke kelas pertama yang valid saat TA/kelas berubah; `GET /api/jadwal` menampilkan
  **seluruh rombel** bila tidak ada kelas yang cocok dengan TA (data master kelas tetap terbaca).
- `GET /api/mapel?ta=` menghitung kolom **Slot** per tahun pelajaran terpilih (sebelumnya selalu TA aktif → 0 saat
  menyusun TA baru); tab Mata Pelajaran memakai `filters.ta` dan memuat ulang saat TA berubah.

### 6. Absensi guru: check-in real-time, sakit/izin, alfa otomatis, kamera
- `POST /api/absensi-guru/checkin` — satu klik **Hadir / Sakit / Izin**; hanya pada hari & jam pelajaran berlangsung,
  hanya slot milik guru (atau admin/wakasek atas nama guru); `waktu_submit` disimpan sampai **detik** dan status
  **terkunci** (check-in kedua → 409). Sakit/Izin wajib alasan ≥ 5 karakter.
- `POST /api/absensi-guru/jurnal` — melengkapi **jurnal materi + foto** setelah check-in (status tidak berubah).
  Foto: `<input type="file" accept="image/*" capture="environment">` (langsung kamera).
- `POST /api/absensi-guru/submit` tetap ada (koreksi/admin); menolak **perubahan status** pada baris hasil
  check-in/alfa otomatis kecuali oleh admin/wakasek.
- **Alfa otomatis**: `dbm.autoAlfaGuru(tgl)` mencatat `status='alpha'` untuk slot yang jendelanya sudah berakhir tanpa
  absensi (`validasi.auto=true`), idempoten via unique `(jadwal_id,tanggal)`. Dipanggil saat GET `/api/absensi-guru`
  & `/api/absensi-guru/rekap` serta scheduler per tenant (`akademik.autoAlfaHarian()` tiap 60 detik).
  Dapat dimatikan: setting `absensi_auto_alpha` (checkbox **Alfa otomatis** di Pengaturan Jadwal & banner di halaman).
- UI `AbsensiGuru.jsx`: tombol **Check-in Hadir / Sakit / Izin** (disabled + gembok bila di luar jam atau sudah
  tercatat), modal alasan, modal jurnal & foto kamera; setelah check-in hadir modal jurnal terbuka otomatis.
- **Presensi siswa**: default **H** (sudah ada), kotak **cari nama** real-time di atas daftar (`[data-cari-siswa]`),
  tombol **Generate Link & Barcode Absensi Kelas**, dan **verifikasi nama pencatat** — server menolak nama yang tidak
  terdaftar di kelas sesi (`detail.siswa`), input memakai `datalist` nama siswa.

### Gotcha ronde ini
- Kunci unik `absensi_guru(jadwal_id,tanggal)` dipakai `INSERT OR IGNORE` untuk alfa otomatis → jangan menambah
  `INSERT` biasa pada jalur yang sama.
- `autoAlfaGuru` hanya untuk **hari ini**; jangan dipanggil untuk tanggal lampau (data historis tidak diubah).
- `capture="environment"` adalah *hint* browser (mobile membuka kamera; desktop tetap memilih berkas) — jangan
  mengklaim galeri bisa diblokir total.
- Halaman publik memakai token ber-prefix kode sekolah; endpoint baru `/api/public/{aduan,asesmen}/:token/siswa`
  ikut ditangani regex tenant di `server.js`.

### Tes
```bash
node dev-tests/round19.js      # 51 cek API: check-in & penguncian status, sakit/izin, alfa otomatis + toggle,
                               # jurnal & foto, rekap per kelas/mapel (bug SQL), slot mapel per TA,
                               # QR jadwal publik (auth & publik), verifikasi nama ketua kelas
node dev-tests/ui-round19.js   # 51 cek Playwright: tombol check-in + modal jurnal + capture kamera, filter nama,
                               # QR asesmen tidak menumpuk, tidak blank saat pindah instrumen cepat,
                               # hapus riwayat asesmen & aduan massal, autocomplete publik (asesmen & aduan),
                               # header jadwal publik, QR share, matriks & kolom slot, mobile 390px
```
Diperbarui karena perubahan **disengaja**: `akademik.js` (101 — nama pencatat diverifikasi),
`bk.js` (112 — identitas asesmen/aduan via siswa_id + DOB, hapus massal), `ui-bk.js` (57 — alur autocomplete),
`ui-akademik.js` (46 — check-in + jurnal, nama ketua dari daftar siswa).

### Status live setelah ronde 20
- Bundle aktif `assets/index-ChbYaK5u.js`; `/`, `/daftar`, `/super-admin`, `/asesmen/<token>`, `/aduan/<token>`,
  `/jadwal-publik/<token>`, dan portal `/<slug>/portal-siswa` = 200. Endpoint baru
  `GET /api/public/{asesmen,aduan}/:token/siswa` aktif (404 JSON untuk token salah).
- Setting baru `absensi_auto_alpha` (default `1`) otomatis ditambahkan saat server start pada semua DB sekolah.
- Tidak ada perubahan data pengguna; kata sandi akun sekolah tidak disentuh.

---

## Ronde 21 — guru pengampu terkunci, sesi jam per hari, import mapel, multi-tampilan matriks, fix ekspor & sinkronisasi absensi

### 1. Guru pengampu TERKUNCI pada slot jadwal (tidak ada pilihan manual)
- Sumber kebenaran tunggal = **Data Master Mata Pelajaran** (`guru_mapel`, bisa lebih dari satu guru; guru pertama = utama).
- `akademik.js` → `guruTerkunci(mapelId, guruDariForm, guruSaatIni)`:
  - **1 guru pengampu** → guru pada slot **dipaksa** ke guru tersebut (guru dari form/API diabaikan, respons memuat
    peringatan "Guru pengampu … dikunci ke …").
  - **lebih dari 1 pengampu** (kasus nyata: Matematika diajar beberapa guru) → guru slot **hanya boleh salah satu**
    dari daftar pengampu; memilih guru di luar daftar → 400 dengan pesan berisi daftar nama. Slot lama yang gurunya
    sudah termasuk daftar tidak diubah (mencegah penimpaan data yang sah).
  - **belum punya** pengampu → guru dari form **diikat** sebagai pengampu (`INSERT OR IGNORE guru_mapel`) agar
    konsisten pada slot berikutnya (sekaligus menjaga kompatibilitas API/impor lama).
  - mapel tidak dikenal → 400. Respons memuat `guru_pilihan[]`.
- Dipakai juga oleh **impor jadwal**: `preview` menampilkan guru efektif (mapel menang) dan `commitJadwal` memakai
  `guruFinal` = pengampu mapel.
- `GET /api/jadwal` kini mengirim `mapel[].guru/guru_ids/guru_id/guru_nama` (dipakai form slot).
- UI `ModalSlot`: **tidak ada dropdown guru umum**. Satu pengampu → kotak `[data-guru-terkunci]` (nama + badge
  “Terkunci”); beberapa pengampu → select `[data-guru-pengampu]` yang HANYA memuat guru pengampu mapel tersebut.
  Tabel mapel menampilkan chip guru + badge “terkunci” / “N pengampu”.

### 2. Sesi jam pelajaran FLEKSIBEL per hari
- Setting baru **`jadwal_sesi_hari`** = `{ "<hari 0–6>": [ {label,mulai,selesai,istirahat} ] }`; hari tanpa entri
  memakai `jadwal_sesi` (umum). Contoh: Senin jam-1 `Upacara Bendera`, Jumat `Pembiasaan`, istirahat `Sholat`.
- `db.js`: `sesiBernomor()`, `sesiHariMap()`, **`sesiOfHari(cfg, hari)`**; `jadwalConfig()` mengembalikan `sesiHari`.
  `absensiWindow()` + `absensiGuruRekap()` + `autoAlfaGuru()` + jam pada sinkronisasi poin memakai sesi hari terkait.
- `POST /api/jadwal/pengaturan` menerima `sesi_hari`; validasi per hari (jam valid, tidak tumpang tindih ≥1 jam pelajaran,
  hanya untuk hari yang aktif) memakai helper `validasiSesi()` yang sama dengan sesi umum.
- UI: panel **Sesi Jam Khusus per Hari** di tab Pengaturan Jadwal (pilih hari → “Atur sesi khusus” → edit label/jam/
  istirahat, atau “Kembali ke sesi umum”). Matriks menampilkan label khusus per hari (chip ungu) dan penanda “khusus”
  di kepala kolom; cetak PDF menampilkan `span.khusus` pada sel.

### 3. Import Mata Pelajaran (massal + guru pengampu)
- `GET /api/mapel/template.xlsx` (sudah ada) + **`POST /api/mapel/import/preview`** dan **`/commit`**:
  kolom `KODE · NAMA MAPEL · KELOMPOK · MAKS JAM/HARI · GURU PENGAMPU` (username atau nama, pisah koma).
  Guru tak dikenal → baris error (tidak disimpan). Kode yang sudah ada = **perbarui** (bukan duplikat); guru pengampu
  diganti sesuai berkas.
- UI tab **Mata Pelajaran**: tombol **Import Mata Pelajaran** + **Template Excel**, modal pratinjau (baris error
  ditandai, ringkasan Baru/Perbarui), dan tabel menampilkan chip guru pengampu (“terkunci”/”utama”).

### 4. Multi-tampilan matriks & ekspor/cetak
- `Matriks` punya **4 tampilan** (`[data-view]`): `kelas` (default, drag & drop), **`vertikal`** (kolom = kelas,
  baris = hari + jam, kode mapel di sel), `guru` (pilih guru → grid jadwalnya), `semua` (semua kelas satu grid).
- `GET /api/jadwal/export.xlsx` & `/api/jadwal/cetak` menerima **`mode=kelas|vertikal|guru|semua`** (+`kelas`,`guru`):
  - Excel memuat **MATRIKS** (grid vertikal/horizontal) **dan** rincian slot; bila kosong tetap ada baris keterangan.
  - Cetak PDF **selalu** merender kerangka kolom/baris meski belum ada slot (tidak lagi hanya pesan
    “Belum ada kelas atau slot jadwal”); bila tidak ada kelas sama sekali, tabel tetap dibuat dengan placeholder
    “(belum ada kelas)”. Kelas tanpa TA otomatis memakai seluruh rombel (fallback `matriksData()`).
- Tombol **Export Excel** & **Cetak/PDF** di toolbar jadwal mengikuti tampilan aktif (`data-export-jadwal`,
  `data-cetak-jadwal`).

### 5. Sinkronisasi jadwal → menu Check-in Absensi Guru (bug diperbaiki)
- **Akar 1 (server)**: `taOf()` memakai `tahunAktif()` (flag `aktif=1`) sedangkan penyimpanan jadwal memakai
  `ta_aktif` (setting dari header TA) → slot yang dibuat pada TA pilihan tidak terbaca di absensi.
  Sekarang `taOf()` = `?ta` → `ta_aktif` → `tahunAktif()`; `GET /api/absensi-guru` juga **fallback** memindai TA lain
  yang memiliki slot pada hari itu (`ta` hasil dipakai dikirim di respons sebagai `ta`, plus `jumlah_slot`).
  `dbm.autoAlfaGuru()` memakai mekanisme yang sama.
- **Akar 2 (klien)**: `new Date().toISOString().slice(0,10)` = tanggal **UTC** → pukul 00:00–07:00 WIB terbaca
  “kemarin” sehingga jadwal hari ini tidak muncul. Ditambahkan helper **`hariIni()`** di `src/api.js` (tanggal lokal)
  dan dipakai `AbsensiGuru.jsx` & `AbsensiSiswa.jsx` (nilai awal + `max`). `AbsensiGuru` juga mengirim `ta` dari
  `ctx.filters.ta`.

### Gotcha
- Jangan menambah select guru kembali di `ModalSlot` — server tetap akan memaksa guru dari mapel, tetapi UI harus
  konsisten (satu sumber kebenaran).
- `jadwalConfig()` mengembalikan `sesiHari` (camelCase). Endpoint publik memakai `config.sesi_hari` (snake) —
  di klien `Jadwal.jsx` keduanya dibaca (`cfg.sesiHari || cfg.sesi_hari`).
- Hook React **tidak boleh** ditaruh setelah `if (!f) return <Spinner/>` (pernah membuat tab Pengaturan jadwal blank);
  `hariEdit` sudah dipindah ke atas.
- Sesi per hari hanya boleh untuk hari yang **aktif**; perubahan hari harus diikuti penghapusan/pengaktifan sesinya.

### Tes
```bash
node dev-tests/round21.js     # 58 cek API: guru terkunci (mapel ber-pengampu, pengikat otomatis, impor),
                              # sesi per hari + validasi, import mapel (preview/commit/idempoten/guru ganda),
                              # ekspor & cetak 4 mode + grid kosong, sinkronisasi TA & tanggal absensi
node dev-tests/ui-round21.js  # 49 cek Playwright: form slot tanpa select guru + kotak terkunci, import mapel,
                              # 4 tampilan matriks, editor sesi per hari + persistensi, cetak/ekspor 4 mode,
                              # absensi guru mendeteksi jadwal hari ini (check-in), mobile 390px
```
Disesuaikan karena perubahan **disengaja**: `akademik.js` (103 — mapel wajib punya pengampu), `ui-akademik.js`
(48 — mapel dipilih tanpa select guru, pencarian publik), `round19.js` (52 — mapel per guru).

### Status live setelah ronde 21
- Bundle baru hasil `npx vite build`; guru pada slot jadwal otomatis mengikuti Data Master Mata Pelajaran untuk
  **semua sekolah** (tidak perlu migrasi data; `guru_mapel` sudah ada).
- Setting `jadwal_sesi_hari` kosong pada instalasi lama = perilaku tetap seperti sebelumnya (sesi umum).

### Status live ronde 21 (diverifikasi)
- Bundle aktif `assets/index-ChbYaK5u.js`; `/`, portal `/smk-pgri-cikoneng/portal-siswa`, `/jadwal-publik/<token>`,
  `/asesmen/<token>`, `/aduan/<token>` = 200. Marker UI baru ada di bundle: `data-guru-terkunci`,
  `data-guru-pengampu`, `data-view`, `data-sesi-per-hari`, `data-import-mapel`.
- Data live tenant 1525: 6 slot jadwal, 6 baris `guru_mapel`; mapel `Matematik` punya **5 pengampu** sehingga aturan
  “>1 pengampu = pilih salah satu dari daftar” dipakai (slot lama tidak diubah otomatis).
- `jadwal_sesi_hari` belum diisi pada kedua sekolah → perilaku jam pelajaran tetap memakai sesi umum sampai pengguna
  mengaturnya di **Pengaturan Jadwal → Sesi Jam Khusus per Hari**.

---

## Ronde 22 — hapus massal (soal/asesmen/layanan BK), cascade hapus mapel, cetak jadwal bersih + Desain Jadwal Pelajaran, matriks rata tengah, alur absensi guru wajib, sync absensi per mapel, portal publik

### 1. Hapus massal (ceklis + Pilih Semua + Hapus Terpilih)
| Menu | Endpoint | Penanda uji |
|---|---|---|
| Soal & Kategori Asesmen | `POST /api/asesmen/soal/delete-masal` (`ids[]`) — nomor butir per instrumen dirapikan ulang | `data-butir-item`, `data-butir-all`, `data-butir-count`, `data-butir-hapus` |
| Hasil Asesmen (responden) | `POST /api/asesmen/hasil/delete` (sudah ada ronde 20) | `data-hasil-item`, `data-hasil-all`, `data-hasil-hapus` |
| Riwayat Program Layanan BK | `POST /api/bk/layanan/delete-masal` (`ids[]`) → tiap baris `dbm.trashAdd('bk_layanan')` (bisa dipulihkan) | `data-layanan-item`, `data-layanan-all`, `data-layanan-count`, `data-layanan-hapus` |

Semua tombol hapus memakai `window.confirm` (dialog konfirmasi) dan dinonaktifkan bila tidak ada pilihan / tanpa izin.

### 2. Hapus Mata Pelajaran + CASCADE (bug "masih dipakai pada N slot jadwal")
- **Akar masalah**: matriks pada TA aktif tampak kosong, tetapi `jadwal` masih berisi slot dari **TA lain** (dan sesi/absensi turunannya) → pengecekan lama menolak 409.
- `DELETE /api/mapel/:id?dry=1` → **pratinjau dampak** `{slot, ta, sesi, absensi_siswa, absensi_guru, poin_otomatis, guru_pengampu}` (dipakai dialog konfirmasi UI).
- `DELETE /api/mapel/:id` menghapus dalam **satu transaksi**: `absensi_guru` (slot), `absensi_siswa` + `kejadian` otomatis (`sumber='absensi'`) → `absensi_sesi` → `jadwal` (SEMUA TA) → `guru_mapel` → `mapel`. Setelah itu mapel dapat dibuat ulang dengan kode yang sama.
- UI `MapelTab.hapus()` memanggil dry-run lebih dulu dan menampilkan rincian relasi di dialog; tombol hapus bertanda `data-hapus-mapel="<id>"` (+ `data-edit-mapel` untuk pensil).

### 3. Cetak jadwal bersih + menu **Desain Jadwal Pelajaran**
- Halaman cetak jadwal (panel & publik) **tidak lagi** memuat teks instruksi “Pratinjau cetak — Ctrl/Cmd + P”, footer “Dicetak … oleh …”, maupun sub-judul mode otomatis
  (“MATRIKS VERTIKAL …”). Toolbar cetak (`.bar`) dan tombol disembunyikan lewat `@media print{ .bar,.no-print,.btn{display:none!important} }`.
- `printdoc.js` (dipakai rekap absensi, layanan BK, hasil asesmen) juga kehilangan baris footer “Dicetak otomatis … pada …”; tombol/aksi disembunyikan saat print
  (`button` & `.btn` ikut `display:none`).
- **Setting baru** (`dbm.jadwalDesain()`): `jadwal_judul` (JADWAL PELAJARAN), `jadwal_semester` (Semester Genap),
  `jadwal_ta_teks` (kosong = `Tahun Pelajaran <TA aktif>`), `jadwal_ttd_tempat` (kosong = `print_tempat`), `jadwal_ttd_tanggal`
  (kosong = bulan & tahun cetak), `jadwal_pengawas_tampil` (1), `jadwal_pengawas_nama/nip`, `jadwal_kepala_nama/nip`
  (fallback `kepala_*`), `jadwal_wakasek_nama/nip` (fallback `wakasek_*`), `jadwal_wakasek_jabatan`.
- **Menu baru** `desain_jadwal` (nav grup Akademik, ikon `FileSignature`, halaman `#/desain_jadwal`,
  `src/pages/DesainJadwal.jsx`) + `GET/POST /api/jadwal/desain`. Ditolak bila judul kosong.
- Blok tanda tangan 3 kolom: **Mengetahui, Pengawas Pembina** (opsional) · **Kepala Sekolah** · **Tempat, Tanggal + Wakasek Kurikulum**,
  dengan ruang tanda tangan 48 px, nama bergaris bawah, dan NIP. Dipakai `htmlCetakJadwal()` (panel & publik) dan header Excel.

### 4. Matriks jadwal: colspan & rata tengah
- **Bug baris hari melebar**: `colspan` baris judul hari pada matriks vertikal dihitung `jumlahKelas + 2` (harus `+ 1`), sehingga tabel melebar.
  Sekarang `colspan = daftarKolom.length + 1` di UI **dan** `jmlKolom = (kolom.length || 1) + 1` di cetak; kolom placeholder
  “(belum ada kelas)” dipakai saat belum ada kelas supaya `<thead>` dan `<tbody>` tetap konsisten.
- Seluruh isi sel (nama mapel, kode, jam, label Upacara/Istirahat, header hari) kini `text-center` + `align-middle`;
  CSS cetak `table.grid th, table.grid td { text-align:center; vertical-align:middle }`.

### 5. Alur absensi guru: absensi siswa → jurnal → foto, sanksi ALFA
- `dbm.absensiAlur(jadwalId, tanggal)` mengembalikan status 3 langkah (`absensi_siswa{total,terisi,lengkap}`,
  `jurnal{lengkap,min}`, `foto{wajib,ada}`, `selesai`).
- `GET /api/absensi-guru/alur?jadwal_id=&tanggal=` untuk UI; `GET /api/absensi-guru` juga menyertakan `alur` tiap slot.
- **`POST /api/absensi-guru/jurnal` menolak 400 `{butuh_absensi_siswa:true}`** bila status `hadir` dan absensi siswa belum lengkap.
- `checkin` mengembalikan `langkah: ['absensi_siswa','jurnal','foto']` dan pesan berurutan.
- **Sanksi ALFA** (`dbm.autoAlfaGuru`): selain slot tanpa check-in, baris berstatus `hadir` yang sampai jam pelajaran berakhir
  belum menyelesaikan absensi siswa / jurnal / foto diturunkan menjadi `alpha` (`validasi.auto=true`, `catatan` menyebut apa yang kurang).
- UI `AbsensiGuru`: modal jurnal kini punya panel **Alur wajib** (`data-alur-absensi`) berisi 3 langkah dengan tanda ✓,
  tombol “Isi Absensi Siswa” (`data-buka-absensi-siswa`), dan peringatan sanksi; tombol pada kartu berubah menjadi
  “Lanjutkan: Absensi → Jurnal → Foto” selama alur belum selesai.

### 6. Sinkronisasi menu Absensi Siswa per Mapel
- `GET /api/absensi-siswa`: bila TA pandangan tidak punya slot hari itu, **fallback** memindai TA lain (sama seperti absensi guru);
  respons memuat `ta` & `jumlah_slot`. Guru juga melihat slot ketika ia terdaftar sebagai **pengampu mapel** (`guru_mapel`),
  dan `sesiBolehKelola()` mengizinkan pengampu mengelola sesi.

### 7. Portal publik jadwal
- Tombol **Export Excel** (`data-publik-export` → `/api/public/jadwal/:token/export.xlsx`) dan **Cetak / Simpan PDF**
  (`data-publik-cetak` → `/api/public/jadwal/:token/cetak`) di toolbar filter; keduanya tanpa login (validasi token).
- **Dihapus** dari halaman publik: “Bagikan jadwal ini”, Barcode/QR, Salin Tautan, Unduh QR (endpoint QR panel admin tetap ada).
- `excelJadwal(m, oleh)` diekstrak dari endpoint admin agar dipakai bersama panel & publik.

### Gotcha
- `hariIni()` di `src/api.js` kini memakai **zona waktu aplikasi** (`Asia/Jakarta`) lewat `Intl.DateTimeFormat`, bukan zona perangkat/UTC —
  perangkat dengan zona lain tidak lagi “kehilangan” jadwal hari ini.
- `api(path)` default **GET**; untuk `DELETE` wajib `api(path, { method: 'DELETE' })` (bug ini sempat membuat dialog hapus mapel menampilkan “Endpoint tidak ditemukan.”).
- Hook React tidak boleh diletakkan setelah early-return (`if (!f) return <Spinner/>`) — `hariEdit` di Pengaturan Jadwal sudah dipindah ke atas.
- Dev-test yang menghitung jam (`hhmm`) **wajib** menyetel `process.env.TZ='Asia/Jakarta'`; kalau tidak, pengujian di dini hari UTC menghasilkan jam terbalik (23:19–00:49).

### Tes
```bash
node dev-tests/round22.js     # 56 cek API: hapus massal soal & layanan BK (+Kotak Sampah), cascade hapus mapel
                              # (dry-run, lintas TA, bisa dibuat ulang), desain & kebersihan cetak (tanpa instruksi/footer,
                              # @media print, colspan, rata tengah), portal publik export/cetak, alur absensi guru +
                              # sanksi alfa, sinkronisasi absensi siswa per mapel
node dev-tests/ui-round22.js  # 35 cek Playwright: ceklis & hapus terpilih (soal, layanan BK), dialog dampak hapus mapel,
                              # menu Desain Jadwal + persistensi, matriks vertikal (lebar & rata tengah), alur absensi guru,
                              # portal publik (export/cetak ada, tombol berbagi hilang), mobile 390px
```
Disesuaikan karena perubahan **disengaja**: `round19.js` (54 — jurnal menunggu absensi siswa), `ui-round19.js`
(51 — tombol berbagi publik → export/cetak), `print.js` (12 — data rekap ditambah karena footer “Dicetak” dihapus),
`ui-round21` (49), `ui-akademik` (48), `akademik` (103), `bk` (112), `ui-bk` (57), `round21` (58).

### Status live ronde 22
- Bundle aktif `assets/index-ChbYaK5u.js`; marker UI baru ada di bundel: `data-butir-all`, `data-layanan-all`,
  `data-hapus-mapel`, `data-desain-judul`, `data-publik-export`, `data-alur-absensi`, `data-grid-vertikal`.
  `/` & portal `/<slug>/portal-siswa` = 200.
- Fitur `desain_jadwal` otomatis mendapat baris izin pada semua DB sekolah (INSERT OR IGNORE saat boot) dan
  ditambahkan ke paket basic/premium + `fitur_override` lewat migrasi `BARU` di `saas.init()`.
- Pengaturan desain jadwal masih default pada kedua sekolah (`JADWAL PELAJARAN` · `Semester Genap` · TA otomatis ·
  tempat dari `print_tempat`); pemilik dapat mengubahnya di menu **Akademik → Desain Jadwal Pelajaran**.

---

## Ronde 23 tata-tertib — jadwal kosong, tanda tangan cetak jadwal, Tukar Jadwal Mengajar

### 1. Absensi Siswa per Mapel "Tidak ada jadwal pada tanggal ini" (bug diperbaiki)
- **Akar masalah** (diverifikasi pada DB live): slot `jadwal` tersimpan dengan `ta_id` menunjuk **tahun pelajaran yang
  sudah dihapus**. Nilai `ta` berasal dari `localStorage 'stt:filters'` di peramban sehingga `POST /api/jadwal/slot`
  menulis `ta_id` lama, lalu `jadwalRows(taAktif)` mengembalikan nol baris.
- **Perbaikan berlapis**:
  1. `akademik.js` → `taOf(q)` kini **memvalidasi** `ta` terhadap `tahunList()`; nilai tak dikenal diganti TA aktif.
  2. `server.js` → `filters(q)` sama (dipakai semua endpoint daftar/rekap).
  3. `src/App.jsx` → saat bootstrap, `filters.ta` di localStorage divalidasi terhadap `boot.tahun` (TA basi → TA server).
  4. `db.js` → `runMigrations()` menjalankan **reparasi** `UPDATE jadwal SET ta_id=…` (TA milik kelas pada `kelas_ids`,
     fallback TA aktif) untuk semua `ta_id` yatim, plus `DELETE FROM jadwal_tukar WHERE jadwal_id NOT IN (SELECT id FROM jadwal)`.
  5. `tahunDelete()` sekarang ikut menghapus `jadwal`, `absensi_sesi`, `absensi_siswa`, `absensi_guru`, `jadwal_tukar`
     milik TA itu (dulu tidak → menghasilkan slot yatim), dan `tahunDampak()` menampilkan jumlah `jadwal`.
- Migrasi berjalan otomatis saat server start/republish: slot yatim langsung kembali muncul di menu Jadwal,
  Absensi Guru, dan Absensi Siswa per Mapel.

### 2. Tanda tangan cetak jadwal pelajaran (sesuai contoh sekolah)
`htmlCetakJadwal()` (akademik.js) memakai struktur baru:
- baris atas: **Kepala Sekolah,** (kiri) · `Tempat, tanggal` + **Wakasek Kurikulum,** (kanan);
- baris bawah: **Mengetahui, / Pengawas Pembina,** di tengah halaman (`class="ttd-pengawas"`, lebar 42%).
- Label di atas Kepala Sekolah **tidak lagi** "Mengetahui, Kepala <nama sekolah>" — cukup "Kepala Sekolah,".
- CSS `.ttd-grid` = block (bukan flex) + `.ttd-row{display:flex}` + `.ttd-pengawas{width:42%;margin:16px auto 0}`.
- `round22.js` disesuaikan (cek `Kepala Sekolah,` + label Mengetahui hanya di atas Pengawas).

### 3. Tukar Jadwal Mengajar Antar Guru (temporer 1 sesi/tanggal)
**Tabel `jadwal_tukar`** (dibuat dari `TUKAR_SCHEMA_SQL`, dijalankan juga oleh `runMigrations()`):
`jadwal_id, tanggal, ta_id, dari_guru, ke_guru, mapel_id, alasan, status (pending|diterima|ditolak|batal),
catatan_putus, diputus_at/oleh/nama, created_at, updated_at`.
**Helper `db.js`**: `tukarOf`, `tukarAktif`, `tukarMap(tanggal)` (peta jadwal_id → tukar diterima),
`tukarGuruEfektif(row, tanggal)`, `tukarMasuk(guruId)`, `tukarKeluar(guruId)`.
**Guru EFEKTIF** dipakai di: `/api/absensi-guru` (filter + `bisa_tukar` + `tukar`), check-in (pemilik sesi),
jurnal, submit, `/api/absensi-siswa` (filter + `guru_efektif_id`), `sesiBolehKelola(user,row,tanggal)`,
`autoAlfaGuru()` (alfa jatuh ke guru pengganti), dan `absensiGuruRekap()`.

**Rute baru (akademik.js)**
| Rute | Fungsi |
|---|---|
| `GET /api/tukar-jadwal/kandidat?jadwal_id&tanggal` | info slot + kandidat guru + mapelnya + riwayat |
| `POST /api/tukar-jadwal` | ajukan (`ke_guru`, `mapel_id`, `alasan`) — hanya guru pemilik sesi, hari ini |
| `GET /api/tukar-jadwal` | `masuk` (menunggu jawaban) + `keluar` (riwayat saya) |
| `POST /api/tukar-jadwal/putus` | `aksi: terima｜tolak｜batal` (terima/tolak hanya guru tujuan; batal hanya pengaju) |
- **Validasi kelas otomatis**: kandidat = guru yang punya slot pada TA tersebut dengan **kelas yang sama**;
  guru kelas lain tidak pernah muncul (server menolak 409 bila dipaksa). Mapel tujuan harus mapel yang diampu
  guru pengganti di kelas itu (default mapel slot).
- Guru yang pada jam yang sama sudah mengajar kelas lain ditandai `bentrok` (opsi disabled + server 409).
- Satu sesi+tanggal hanya boleh punya satu tukar `diterima`; menerima satu permintaan otomatis menolak pending lain.
- Audit modul `absensi_guru` (`TAMBAH`/`UBAH`), pesan "Permintaan tukar jadwal …" / "Menerima/Menolak/Membatalkan …".
- **Temporer**: tabel `jadwal` tidak pernah diubah → pekan berikutnya kembali normal otomatis.
- Dashboard (`/api/dashboard`) mengirim `tukar_masuk`; `src/pages/Dashboard.jsx` menampilkan kartu + pop-up
  (sekali per sesi, `sessionStorage stt:tukar:<id…>`) dengan tombol Terima/Tolak.
- `src/pages/AbsensiGuru.jsx`: tombol **Tukar Jadwal** di bawah Check-in/Sakit/Izin (`data-tukar`), modal
  `ModalTukar` (`data-modal-tukar`, `data-pilih-guru-tukar`, `data-pilih-mapel-tukar`, `data-kirim-tukar`),
  kartu **Permintaan Tukar Jadwal Masuk** (`data-tukar-masuk`, `data-tukar-terima`, `data-tukar-tolak`) dan
  tabel pengajuan saya (`data-tbl-tukar-keluar`, `data-tukar-batal`).
- `jadwal_tukar` **tidak** dimasukkan `BACKUP_TABLES` (backup/restore JSON tidak memuat tabel jadwal); baris yang
  menunjuk slot terhapus dibersihkan otomatis saat boot.

### Tes
```bash
node dev-tests/tukar.js     # 49 cek: TA basi diabaikan, slot yatim diperbaiki migrasi & muncul di absensi siswa,
                            # urutan/tanpa label TTD jadwal, kandidat hanya guru kelas sama, validasi mapel,
                            # tolak/terima/batal, sesi pindah ke guru pengganti (check-in + absensi siswa),
                            # guru asli tidak bisa check-in, pekan berikutnya kembali normal, RBAC
node dev-tests/ui-tukar.js  # 17 cek Playwright: tombol Tukar Jadwal di bawah Izin, modal (filter guru & mapel),
                            # kirim permintaan, box permintaan masuk + Terima, sesi pengganti di kartu guru tujuan,
                            # guru asli kehilangan sesi, mobile 390px, tanpa error JS
```
Regresi lulus: `akademik` (103), `round19` (54), `round21` (58), `round22` (57), `round3` (63 tanpa DEMO_SEED),
`round4` (63), `smoke` (58), `kelas-ta` (37), `print` (12).

---

## Ronde 24 tata-tertib — ponsel (bottom nav per role), penguncian waktu, presensi publik

### 1. Halaman publik presensi (`/presensi/<token>`)
- **Bug judul tertimpa diperbaiki**: `<main>` dulu memakai `-mt-5` sehingga kartu konten menimpa header
  "ABSENSI <SEKOLAH>". Sekarang `pt-4` (tanpa margin negatif) → judul & header bersih di atas konten.
- **Tombol Simpan sejajar**: footer `AbsensiKelas` (mode publik) memakai grid
  `sm:grid-cols-[minmax(0,1fr)_auto]` — di ponsel tombol selebar kolom nama (satu kolom), di desktop
  satu baris dengan input. Tidak ada lagi tombol melayang/keluar kartu. Hook uji: `[data-footer-publik]`.
- **Audit trail pengisi**: tabel baru **`absensi_pencatat`** (`PENCATAT_SCHEMA_SQL`, unique `sesi_id+siswa_id`).
  `POST /api/public/presensi/:token` mencatat nama + kelas pengisi; `sesiDetail()` mengirim `pencatat_info`
  yang ditampilkan sebagai *"Absensi ini diwakili/diisi oleh: [Nama] (Siswa Kelas X)"*
  (`[data-pencatat-info]`) di halaman publik **dan** panel guru.
- **Batas 1× isi per siswa per sesi**: bila siswa yang sama submit lagi → **409** ("sudah pernah Anda isi").
  Siswa lain tetap boleh mengisi (yang terakhir tercatat sebagai pengisi).

### 2. Panel guru tanpa "Nama Pencatat"
- `AbsensiKelas` menerima prop `mode` (`'guru'` default · `'publik'`). Mode guru **tidak merender**
  `[data-pencatat]`; yang tampil hanya keterangan *"Dicatat otomatis atas nama <guru login>"* + tombol
  **Simpan Absensi** (`.btn` selebar kartu di ponsel). Server tetap memakai akun login
  (`POST /api/absensi-siswa/simpan` tidak menerima nama pencatat dari klien).

### 3. Penguncian waktu (time-locking) — SERVER + UI
- Setting baru **`absensi_toleransi_tutup`** (0–60 menit, default **0** = terkunci tepat saat jam pelajaran selesai).
  `dbm.jadwalConfig().toleransiTutup` dipakai `absensiWindow()` (guru) dan `sesiDetail()` (siswa) — pengganti
  `absensi_tutup_menit`/`absensi_siswa_tutup_menit` untuk batas **penutupan**. Diatur di
  **Pengaturan Jadwal → "Kunci absensi setelah jam pelajaran selesai (menit)"** (`[data-toleransi-tutup]`).
- `absensiWindow()` mengirim `terkunci` + `selesai`; pesan penutupan menyebut "Sesi absensi sudah **DITUTUP** …".
- Ditutup di server saat lewat: `POST /api/absensi-guru/checkin` (memang sudah), `POST /api/absensi-guru/jurnal`
  (**bypass wakasek dihapus**), `POST /api/absensi-siswa/simpan` (**bypass kurikulum dihapus**),
  `POST /api/absensi-siswa/sesi` (tidak bisa membuat sesi setelah berakhir), `POST /api/tukar-jadwal`
  (tidak bisa mengajukan untuk sesi yang sudah lewat).
- UI: kartu absensi guru & editor presensi menampilkan blok `[data-terkunci]` + tombol **nonaktif**
  (check-in/sakit/izin, H/S/I/A/B, Simpan → label "Sesi Ditutup"), `bisa_tukar` hanya sebelum jam berakhir.

### 4. Navigasi ponsel + pengaturan per role (desktop TIDAK berubah)
- **Bootstrap** mengirim `bottom_nav: [{key,label,icon}]` (hasil `dbm.bottomNavFor(user)`).
- **Default Guru Mata Pelajaran** (permintaan sekolah): `kejadian` → **`absensi_guru`** → `jurnal`
  (`Input Kejadian` · `Absensi Guru Mapel` · `Buku Penghubung`). `BOTTOM_NAV_DEFAULT` juga mengisi role lain.
- Setting `bottom_nav` (JSON per role) + helper `bottomNavConfig()/bottomNavFor()/setBottomNav()`; role **utama**
  (yang pertama) menentukan susunan. Maksimum **5** tombol.
- **Halaman admin baru** `GET /api/nav-mobile` · `POST /api/nav-mobile` · `POST /api/nav-mobile/reset`
  (fitur RBAC baru **`nav_mobile`**, menu "Navigasi Mobile & Menu" grup Sistem — hanya admin).
  UI `src/pages/NavMobile.jsx`: pilih role → susun urutan (naik/turun/hapus/tambah) → pratinjau → simpan/reset.
- `src/App.jsx`: komponen **`BottomNav`** (`[data-bottom-nav]`, `[data-bottom-nav-item]`, mobile-only `lg:hidden`),
  tombol tengah (index tengah) dinaikkan + highlight oranye. Header ponsel: logo sekolah + nama pengguna +
  **hamburger di pojok kanan** (`[data-hamburger]`, `aria-label="Menu"` dipertahankan untuk tes lama);
  laci menu punya header profil (`[data-drawer-head]`) + seluruh menu (Jadwal, Rekap, Pengaturan, …).
  Konten diberi `pb-24 lg:pb-5`, footer `pb-28 lg:pb-6`, toast `bottom-20 lg:bottom-4` agar tidak tertutup.

### 5. Tes
```bash
node dev-tests/round24.js     # 54 cek API: time-lock (check-in/jurnal/presensi/sesi/tukar), toleransi,
                              # audit trail + batas 1x isi, presensi guru tanpa nama pencatat,
                              # bottom nav default/ubah/reset + RBAC + audit
node dev-tests/ui-round24.js  # 33 cek Playwright: judul tidak tertimpa, tombol Simpan sejajar (mobile+desktop),
                              # info "diwakili/diisi oleh", blokir 2x isi, panel guru tanpa pencatat,
                              # tampilan terkunci, bottom nav 3 tombol + highlight tengah, hamburger kanan,
                              # laci menu, desktop tanpa bottom nav, admin ubah susunan via UI
```
Disesuaikan karena perubahan **disengaja**: `ui-akademik.js` (panel guru tanpa `[data-pencatat]`),
`ui-round12.js` (navigasi langsung `#/kategori` — label sidebar ambigu), `ui-round15.js`
(`aside nav` + tunggu `[data-bottom-nav-item]` di ponsel; cek pemeliharaan memakai `aside`),
`round22.js` (label TTD jadwal), `round19`/`round21`/`akademik` tetap lulus.

---

## Ronde 25 tata-tertib — jadwal mengajar guru, hapus riwayat absensi, rekap bulanan, WA Fonnte, guru pengganti

### 1. Daftar jadwal mengajar guru (hari ini + hari berikutnya)
- Endpoint baru **`GET /api/absensi-guru/jadwal-mengajar?hari=7`** (maks 21 hari): semua sesi milik guru
  (memakai guru EFEKTIF — termasuk hasil tukar/penugasan) dikelompokkan per tanggal, lengkap dengan
  `window` (aktif/buka/tutup/hari_ini), `terkunci`, `alasan_singkat`, dan `countdown {arah,detik}`.
  Aturan label: hari lain → *"Hanya dapat diisi pada hari <Hari> (tanggal)"*; hari ini & belum buka →
  *"Belum waktunya — dibuka HH:MM"* + hitung mundur; setelah jam selesai → *"Sesi sudah berakhir / ditutup"*.
- `src/pages/AbsensiGuru.jsx`: kartu **"Jadwal Mengajar Saya — Hari Ini & Hari Berikutnya"** (`[data-agenda-jadwal]`,
  `[data-agenda-slot]`, `[data-agenda-checkin]`, `[data-agenda-terkunci]`) + ticker 1 detik (`sisaDetik()`).
  Tombol Check-in hanya muncul pada sesi hari ini yang sedang berjalan; selain itu tombol **Nonaktif** (disabled).
- Server tetap menolak semua aksi di luar jendela (check-in, presensi, jurnal, tukar jadwal, buat sesi).

### 2. Hapus riwayat absensi (Bulk Delete & Filtered Delete) — WAJIB PIN
Semua endpoint memakai `verifikasiPin()` (`lib.verifyPassword` atas kata sandi akun) dan menulis snapshot baris
yang dihapus ke `data/snapshots/pre-hapus-absensi-*` (retensi 3) lewat `dbm.snapshotJson()` + audit `HAPUS`.
| Endpoint | Fungsi |
|---|---|
| `POST /api/rekap/absensi-siswa/hapus` | hapus baris terpilih (`ids[]`) |
| `POST /api/rekap/absensi-siswa/hapus-filter` | hapus per `dari`+`sampai`(+`kelas`/`mapel`) |
| `POST /api/rekap/absensi-guru/hapus` | hapus terpilih (`ids[]` atau `items[{jadwal_id,tanggal}]`) |
| `POST /api/rekap/absensi-guru/hapus-filter` | hapus per rentang tanggal (+`guru`), termasuk `absensi_guru_izin` |
- UI: tab **"Hapus Riwayat"** di `RekapAbsensiSiswa` (ceklis + Pilih Semua + form Dari/Sampai/Kelas) dan di
  `RekapAbsensiGuru` (ceklis + rentang tanggal + guru). Konfirmasi memakai komponen baru
  `src/components/HapusKonfirmasi.jsx` (`[data-modal-hapus]`, `[data-pin-hapus]`, `[data-cek-hapus]`,
  `[data-konfirmasi-hapus]`): wajib kata sandi + centang pernyataan; PIN salah ditolak.
- Baris rekap guru yang **Belum Absen** tidak punya data → ceklis dinonaktifkan (hanya `absensi_id` yang bisa dihapus).

### 3. Rekap Bulanan Terpadu (Portofolio Kelas) — Wali Kelas & Guru BK
- Fitur RBAC baru **`rekap_bulanan`** (nav "Rekap Bulanan Kelas", grup Laporan; view untuk wali_kelas, guru_bk,
  kepala_sekolah, wakasek, admin).
- `GET /api/rekap-bulanan?bulan=YYYY-MM&kelas=` → kehadiran per siswa (H/S/I/A/B + %), poin pelanggaran/prestasi,
  ringkasan **asesmen BK** (jumlah terisi + distribusi per dimensi dari `ASESMEN_KATEGORI`), catatan kejadian.
  Wali kelas hanya dapat membuka kelas yang diampu (`kelasBoleh()`).
- Ekspor: `GET /api/rekap-bulanan/cetak` (PDF/print, kop + **3 blok TTD**: Kepala Sekolah · Wali Kelas · Guru BK),
  `/export` (XLSX 3 bagian), `/word` (.doc). Halaman `src/pages/RekapBulanan.jsx` (`[data-page="rekap-bulanan"]`)
  + kartu pintasan di halaman **Laporan & Surat**.

### 4. WhatsApp otomatis (Fonnte) untuk Alfa/Bolos & guru Sakit/Izin
- `dbm.waConfig()`: `provider` (`generik`/`fonnte`, auto-deteksi dari URL `fonnte.*`), `alfaAktif`, `alfaTemplate`,
  `izinAktif`, `izinTemplate`; helper **`waTemplateAlfa()`, `waTemplateIzin()`, `waFill()`, `waLogAdd()`, `waSudahKirim()`**.
- **`dbm.waSend()`** kini mengirim **form-urlencoded `target`+`message`** ke `api.fonnte.com/send` saat provider
  fonnte (gateway generik tetap JSON), dan membaca balasan `{"status":false,"reason":…}` sebagai gagal.
- `akademik.js`: **`kirimWaAlfa(sesi)`** dipanggil (fire-and-forget) setelah presensi disimpan — guru maupun
  halaman publik; hanya status **A/B**, nomor dari `siswa.parent_phone`, dedupe per `(sesi,siswa)` via `wa_log.ref`.
  **`kirimWaIzinGuru(row,tanggal,status,catatan,user)`** dipanggil saat guru check-in **Sakit/Izin** → kirim ke
  `kepsek_wa` & `wakasek_kur_wa`, dedupe `izin:<jadwal>:<tanggal>`.
- Kolom baru `wa_log.ref` & `wa_log.modul` (ALTER otomatis). Pengaturan baru: `wa_provider`, `wa_alfa_aktif`,
  `wa_template_alfa`, `wa_izin_aktif`, `wa_template_izin` (UI: Pengaturan → WhatsApp Gateway → kartu
  **"Notifikasi Otomatis (Fonnte)"**, `[data-wa-provider]`, `[data-wa-alfa-aktif]`, `[data-wa-izin-aktif]`,
  `[data-wa-template-alfa]`, `[data-wa-template-izin]`).

### 5. Guru Piket & Pengganti (Teacher Substitution)
- **Tabel `jadwal_tukar`** mendapat kolom `jenis` (`tukar`|`penugasan`), `dibuat_oleh`, `dibuat_nama`.
  Penunjukan menulis baris `jenis='penugasan'` + `status='diterima'` → otomatis dipakai `tukarMap()` sehingga
  sesi berpindah ke guru pengganti di **absensi guru, presensi siswa, alfa otomatis, dan rekap**. **Master `jadwal`
  tidak pernah diubah** (berlaku untuk tanggal itu saja).
- **Tabel baru `absensi_guru_izin`** (`IZIN_SCHEMA_SQL`, unik `jadwal_id+tanggal`): karena `absensi_guru` hanya satu
  baris per slot/tanggal, saat guru pengganti ditunjuk baris izin/sakit guru asli **dipindahkan** ke tabel ini agar
  guru pengganti bisa check-in; saat penunjukan **dibatalkan**, baris izin dikembalikan (dan absensi pengganti
  dihapus bila belum ada sesi presensi). `rekap.js guruRekap()` menggabungkan keduanya → disiplin guru asli tetap
  terhitung (baris kedua dengan keterangan "digantikan guru lain").
- Fitur RBAC baru **`guru_pengganti`** (nav "Guru Piket & Pengganti", grup Akademik; write untuk admin,
  kepala_sekolah, wakasek_kurikulum).
- Rute: `GET /api/guru-pengganti?tanggal=`, `GET /api/guru-pengganti/kandidat?jadwal_id&tanggal`,
  `POST /api/guru-pengganti/tunjuk`, `POST /api/guru-pengganti/batal`. Kandidat = guru aktif yang **tidak**
  mengajar pada jam yang sama (guru sekelas diprioritaskan, ditandai `kelas_sama`); kandidat sibuk ditolak 409.
- Halaman `src/pages/GuruPengganti.jsx` (`[data-page="guru-pengganti"]`, `[data-tbl="guru-pengganti"]`,
  `[data-tidak-hadir]`, `[data-tunjuk]`, `[data-modal-pengganti]`, `[data-kandidat]`, `[data-simpan-pengganti]`,
  `[data-batal]`) + navigasi tanggal (sebelumnya/berikutnya).

### 6. Tes
```bash
node dev-tests/round25.js     # 79 cek API: jadwal mengajar (hari ini/besok/belum waktunya/hitung mundur),
                              # time-lock, WA Fonnte (form-urlencoded, dedupe, header token) + notifikasi izin guru,
                              # guru pengganti (kandidat, penunjukan, master jadwal utuh, izin tetap tercatat, batal, RBAC),
                              # rekap bulanan + cetak/Excel/Word + akses wali kelas,
                              # hapus riwayat siswa & guru (PIN, filter, snapshot, audit)
node dev-tests/ui-round25.js  # 41 cek Playwright: agenda jadwal + tombol terkunci/hitung mundur,
                              # tab hapus (ceklis, Pilih Semua, modal PIN salah/benar) siswa & guru,
                              # rekap bulanan (tab & ekspor), guru pengganti (tidak hadir, modal, penunjukan, batal),
                              # pengaturan Fonnte, mobile 390px, tanpa error JS
```
Regresi lulus: akademik 103, round19 54, round21 58, round22 57, tukar 49, round24 54, round2 62, round3 63,
round4 63, round12 50, round15 72, kelas-ta 38, print 12, bk 112, round16 42, smoke 58, ui-akademik 50,
ui-tukar 17, ui-round24 33, ui-round19 51, ui-round21 49, ui-round12 32, ui-round15 22, ui-round22 35,
ui-round2 42, ui-round4 34, ui-kop 22, ui-kategori 28.

---

## Ronde 30 tata-tertib — tampilan CETAK/PDF Kalender Akademik & Jadwal Pelajaran

Diminta pemilik. Tidak ada perubahan `src/` → **tidak perlu `npx vite build`**.

### 1. Kop surat simetris (`doc.kop(settings, { simetris: true })`)
- `doc.js`: opsi baru `simetris` pada `kop()` → markup `.kop.sym` berisi **3 kolom**:
  `kop-side` (logo) · `kop-txt` (teks) · `kop-side` kosong selebar logo. Dengan begitu blok teks
  benar-benar berada di **tengah halaman** (sebelumnya `flex:1` membuat teks bergeser ke kanan
  sebesar lebar logo + gap).
- CSS `.kop.sym .kop-side` ditambahkan di `kopCSS()`; cetak Kalender Akademik kini **memuat
  `doc.kopCSS()`** (sebelumnya halaman kalender tidak punya aturan `.kop` sama sekali sehingga
  logo & teks kop tertumpuk).
- Dipakai `kalenderCetakHtml()` (PDF) dan `htmlCetakJadwal()` (PDF). Dokumen lain (surat, rekap,
  BK, dsb.) tetap memakai perilaku lama (tanpa opsi).

### 2. Halaman cetak Kalender Akademik (`kalenderCetakHtml`)
- **Kop hanya halaman pertama**: `halaman(bag, idx, total)` → `pakaiKop = idx===0`; halaman
  berikutnya memakai `.kal-page.nokop` dengan judul `"<judul> - Semester 2 (Genap)"`.
  (Bila dicetak `?semester=2` saja, kop tetap tampil karena ia halaman pertama dokumen.)
- **Baris "Rentang tanggal efektif" dihapus** dari PDF **dan** Word (Excel tetap memuatnya sebagai
  keterangan data).
- **Tanda tangan hanya di halaman terakhir**: `.ttd-grid` (2 kolom: kiri `Kepala <sekolah>` tanpa
  "Mengetahui,"; kanan `tempat, tanggal` + `Wakasek Bidang Kurikulum`) + `.ttdp` (Pengawas Pembina,
  lebar 42% di tengah bawah). Kelas lama `.ttd3`/`.ttdc` (3 kolom per halaman) dihapus.
- **Kotak bulan = kartu rounded**: `.kal-box` border 1px `#e2e8f0` + `border-radius:10px` +
  bayangan lembut; `.kal-head` rata tengah dengan border-bottom; `td.kdd` `text-align/vertical-align:
  center`; sel minggu (bukan hari sekolah) abu-abu muda, bukan merah.
- **Tanggal beragenda: hanya ANGKA yang diwarnai** (label `kdket` di dalam sel dihapus). Warna dipilih
  lewat `warnaAngkaTanggal()` → warna khusus tanggal (`kalender_akademik.warna`) atau yang **paling
  kontras di kertas putih** antara `bg` & `text` kategori (`lebihKontras()` + luminansi) — mencegah
  angka putih untuk kategori berlatar merah.
- **Bulan tanpa agenda**: tidak ada tulisan "Belum ada kegiatan …" (`.kal-list` tidak dirender).
- Word (`/api/kalender-akademik/word`) disamakan: sel hanya angka berwarna, tanpa baris rentang,
  TTD hanya di semester terakhir (2 kolom + pengawas di tengah).

### 3. Cetak Jadwal Pelajaran (`htmlCetakJadwal`) — kartu slot seperti matriks web
- Mode `kelas` & `guru`: **kolom "JAM" di kiri dihapus**; tiap sel = `.kartu` rounded berisi
  `label jam → rentang waktu → kode mapel → nama mapel → kelas → guru (→ ruang/gabungan)`, semuanya
  `text-align:center` (meniru `kartu()` di `src/pages/Jadwal.jsx`).
- `labelSesiOf()` meniru `labelSesi()` web (label kustom "Upacara/Sholat" menang atas "Jam ke-N").
- Sel kosong = `.kartu.kosong` bergaris putus-putus (tetap menampilkan label jam + waktu, seperti
  tombol kosong di web); istirahat = `.kartu.ish` kuning.
- `table.grid{border-collapse:separate;border-spacing:3px}` + `td.slot{border:0}` agar kartu punya
  jarak; `font-size` tabel & `th.jam{width:...}` tetap dibaca dari pengaturan **Desain Jadwal**
  (`jadwal_tampil`) — `kolomJam` kini hanya mengatur kolom "HARI / JAM" pada mode vertikal.

### 4. Tes
```bash
node dev-tests/cetak-kalender.js  # 56 cek (HTML + DOM Playwright + PDF): kop simetris & hanya halaman 1,
                                  # tanpa baris rentang, kotak bulan rounded & rata tengah, tanggal hanya
                                  # angka berwarna, tanpa pesan kosong, TTD hanya halaman terakhir dengan
                                  # urutan Kepala/Wakasek/Pengawas, kartu jadwal (label jam, waktu, mapel,
                                  # kelas, guru) rata tengah untuk mode kelas/guru/vertikal/semua
node dev-tests/monitor.js         # 82 cek (disesuaikan: 2 kolom TTD + pengawas, tanpa rentang, Word ikut)
node dev-tests/ui-monitor.js      # 56 cek (disesuaikan: kop sekali, nokop di semester 2)
```
Regresi lulus: akademik 103, round21 58, round22 57, wa-jadwal 55, tukar 49, print 12, kop 25,
kurikulum 88, rekap-scheduler 8, ui-wa-jadwal 29.

### Gotcha
- Jangan memakai `w.text` langsung sebagai warna angka tanggal — untuk kategori berlatar gelap
  (mis. libur `bg:#FF0000, text:#FFFFFF`) hasilnya angka putih yang tak terlihat di kertas putih.
- `akademik.js` mendefinisikan CSS `.kop` sendiri untuk cetak jadwal; aturan inline `doc.kop()`
  menang, tetapi halaman **kalender** wajib menyertakan `doc.kopCSS()`.

---

## Ronde 31 tata-tertib — label jam dobel, matriks kartu halaman publik, kop seimbang, TTD seragam, orientasi kalender

### 1. Label sesi DOBEL pada cetak jadwal (Senin & Jumat) — diperbaiki
- **Penyebab**: pada mode `kelas`/`guru`, `tabelKelas()` merender label hari khusus lewat
  `<span class="khusus">${ss.label}</span>` **dan** lewat `kepalaKartu(ss)` (`<span class="lab">…</span>`).
  Pada hari yang punya `sesi_hari` (mis. Senin "Upacara", Jumat "Pembiasaan") label sesi tercetak dua kali.
- **Perbaikan**: `<span class="khusus">` dihapus dari kartu cetak (`labelSesiOf()` sudah menampilkan label
  kustom). `barisVertikal()` kini juga memakai aturan label yang sama (label kustom menang atas "Jam ke-1").
- Aturan tetap: jangan menambah badge label kedua di dalam `.kartu` — cukup satu `.lab`.

### 2. Halaman PUBLIK `/jadwal-publik/<token>` memakai matriks kartu slot
- Berkas baru `src/jadwalSesi.js`: `sesiUntuk(cfg, hari)` (menghormati `cfg.sesi_hari`), `durasiSesi`,
  `tinggiSesi`, `labelSesi`, `sesiPadat`, `HARI_NAMA` — **sumber tunggal** rumus label & tinggi kartu.
- Berkas baru `src/components/JadwalKartu.jsx`: `KartuSlot`, `KartuKosong`, `KartuIstirahat`, `KepalaHari`
  (markup & kelas Tailwind sama dengan kartu di `src/pages/Jadwal.jsx`; atribut uji
  `data-kartu-slot="mapel|kosong|istirahat"`, `data-slot-label`, `data-slot-jam`, `data-slot-mapel`,
  `data-slot-kelas`, `data-slot-guru`, `data-sesi-istirahat`, `data-hari-khusus`).
- `JadwalPublik.jsx` tidak lagi memakai `<table>`: satu blok per kelas berisi **kolom hari → kartu**
  (peta `hari|sesi|kelas` untuk pencarian O(1)). Filter **kelas** maupun **guru** tetap memakai matriks
  kartu; semua teks kartu `text-center`; tinggi kartu proporsional durasi sesi.
- Cetak & ekspor dari halaman publik memakai endpoint yang sama (`htmlCetakJadwal`) → bentuk kartu identik.

### 3. Kop surat: simetris, logo seimbang, tiap baris satu baris (`doc.kop`)
- `kop(settings, { simetris, balance, widthPx })`:
  - `simetris` → `.kop.sym`: elemen `img` **absolut di tepi kiri**, `.kop-txt` selebar penuh dengan
    perataan tengah + `padding:0 <pad>` → teks tepat di TENGAH halaman, logo **tidak lagi menggeser** teks
    dan **tidak menabrak** teks (lebar maksimum logo = `pad`).
  - `pad = clamp(round(widthPx × 0,17), 64, 220)`; semua baris diperkecil dengan **satu faktor yang sama**
    (`skala = textW / lebarBarisTerpanjang`, minimum 0,62) → setiap baris (termasuk nama sekolah) tetap SATU
    baris dan proporsi antar-baris tetap sama seperti kop standar.
  - `balance` → tinggi logo = `max(kop_logo_h, 0,95 × tinggi blok teks)` dengan `width:auto`
    (rasio gambar terjaga; dulu kotak 100×100 membuat logo 1,46:1 tampil hanya 100×68).
  - `widthPx` = lebar isi kertas: kalender portrait 726 / landscape 1032–1055, jadwal (A4 landscape) 1055.
- Estimasi lebar teks memakai tabel `CHAR_W` yang **dikalibrasi** terhadap lebar asli Times New Roman
  (rasio ±1,0). Mode standar (surat/rekap/BK) tidak berubah.

### 4. Tanda tangan kalender = jadwal (nama sejajar)
- `kalenderDokumen()` mengambil pejabat dari **`dbm.jadwalDesain()`** — kepala `jadwal_kepala_nama`,
  wakasek `jadwal_wakasek_nama` + `jadwal_wakasek_jabatan` ("Wakasek Kurikulum"), pengawas
  `jadwal_pengawas_nama`. **Jangan** memakai `wakasek_nama` (Wakasek Kesiswaan) di kalender.
- Label: `Kepala Sekolah,` (tanpa "Mengetahui") · `tempat, tanggal` + jabatan wakasek · `Pengawas Pembina,`.
- Kedua kolom diawali **dua baris** (kolom kiri diberi baris `&nbsp;`) sehingga nama kepala sekolah dan nama
  wakasek **selalu sejajar** (diukur `top` selisih 0 px) — berlaku untuk cetak jadwal maupun kalender.

### 5. Orientasi cetak kalender (portrait / landscape)
- `GET /api/kalender-akademik/cetak?orient=portrait|landscape` (bawaan portrait):
  `@page A4 portrait|landscape`, grid bulan **2 kolom** (portrait) / **3 kolom** (landscape),
  tinggi sel sedikit dipadatkan di landscape.
- Toolbar dokumen punya tombol **Portrait** & **Landscape** (mempertahankan `ta` & `semester`) + tombol cetak.
- Halaman `/kalender_akademik` menyediakan dua tombol: **Cetak Portrait** & **Cetak Landscape**
  (`data-kal-cetak-portrait` / `data-kal-cetak-landscape`).

### 6. Tes
```bash
node dev-tests/publik-jadwal.js   # 33 cek: API publik (sesi khusus ikut terkirim), filter kelas/guru,
                                  # cetak publik memakai kartu & 1 label per kartu, SPA: tanpa tabel,
                                  # kartu (label, jam, kode+nama mapel, kelas, guru) rata tengah,
                                  # Upacara/Pembiasaan, tinggi proporsional, filter guru/kelas tetap kartu,
                                  # mobile 390px, tanpa error JS
node dev-tests/cetak-kalender.js  # 78 cek (ditambah): kop simetris & tiap baris 1 baris, nama sekolah 1 baris,
                                  # logo tidak menabrak teks & seimbang (≥70% tinggi kop), TTD kalender == jadwal
                                  # (nama kepala & wakasek sejajar), orientasi landscape (3 kolom, PDF 2 halaman)
```
Regresi lulus: akademik 103, round21 58, round22 57, wa-jadwal 55, tukar 49, sesi-hari 22, monitor 82,
ui-monitor 56, kurikulum 88, kop 25, print 12, ui-kop 22, ui-round21 49, ui-round22 35, round11 44,
round25 79, smoke 58, base 7.

### Gotcha
- **Jangan** memakai `width`+`height` tetap untuk logo kop: logo non-persegi jadi mengecil (letterbox).
  Pakai `height` + `width:auto` + `max-width` = gutter.
- `kop.sym` memakai `position:absolute` pada `img`; tanpa logo, hanya `class="kop sym"` + `.kop-txt width:100%`
  yang tampil (jangan mengandalkan keberadaan `img` pada tes).
- Halaman publik wajib di-rebuild (`npx vite build`) setelah mengubah `src/`.

---

## Ronde 32 tata-tertib — cetak jadwal (tanpa tingkat & nama kelas), kalender = tampilan web, cakupan tahun/semester

### 1. Cetak jadwal pelajaran: judul kelas & isi kartu
- `h3.kelas-h` hanya **nama kelas** — keterangan `· Tingkat X` dihapus.
- `selIsi()` **tidak lagi** mencetak nama kelas (`<span class="kls">`); kelas sudah menjadi judul matriks.
  Berlaku untuk mode **per kelas** maupun **per guru** (keduanya memakai `tabelKelas`). Catatan
  `Gabungan: …` tetap dicetak karena berbeda dari judul.
- Font cetak jadwal memakai `Inter, system-ui, …` + stylesheet Google Fonts (sama seperti aplikasi).

### 2. Cetak kalender akademik = bentuk menu Kalender Akademik (persis)
- `gridBulanHtml()` ditulis ulang:
  - Kartu bulan `.kal-box` **rounded 16px**, border 1px `#e2e8f0`, bayangan lembut, padding 7-8px.
  - Kepala kartu **flex**: nama bulan (9,5pt extra-bold) di kiri + `N hari efektif · N libur`
    (angka hijau/merah) di kanan — dihitung dengan `dbm.hariEfektifBulan()`.
  - Grid hari memakai **CSS grid** `repeat(7,1fr)` (bukan tabel) dengan urutan **Sen…Min**.
  - Sel tanggal `div.kdd` rounded 6px; hari bukan sekolah abu-abu muda.
  - **Sel beragenda diwarnai PENUH** (`warnaSelTanggal()`: warna khusus tanggal → warna kategori)
    **plus label kecil** `LIBUR / UJIAN / KEGIATAN / KBM` — sama persis dengan `BulanGrid` di web.
    (Ini MENGEMBALIKAN label di dalam sel yang pada Ronde 30 sempat dihapus — permintaan terbaru
    pemilik: "pokoknya dibuat sama persis".) Warna teks dipilih `lebihKontras()` supaya tetap terbaca.
  - Bulan tanpa agenda: bagian keterangan **kosong** (tanpa "Belum ada kegiatan…").
  - Keterangan di bawah kartu: swatch kecil + rentang tanggal tebal + judul + keterangan.
- Font dokumen: `Inter, system-ui, …` (+ link Google Fonts), kop tetap Times New Roman.

### 3. Cakupan cetak: `cakupan=tahun|semester` + orientasi
- `GET /api/kalender-akademik/cetak?cakupan=tahun` → **seluruh bulan satu tahun pelajaran dalam SATU alur**
  (tanpa `.kal-sem pagebreak`), kop sekali, satu judul, sub-judul hanya "Tahun Pelajaran …", TTD sekali.
- `cakupan=semester` (bawaan) atau `semester=1|2` → perilaku lama (halaman terpisah / satu semester).
- Toolbar dokumen: **Satu Tahun · Per Semester · Portrait · Landscape** (mempertahankan `ta`).
- Halaman `/kalender_akademik`: satu tombol **Cetak / Simpan PDF** (`data-kal-cetak`) membuka modal
  `data-kal-cakupan` (4 opsi: tahun / per semester / semester 1 / semester 2) + `data-kal-orient`
  (portrait/landscape); tombol `data-kal-cetak-proses` membuka dokumen.
- Word: sel beragenda juga diwarnai + label kategori (sama dengan PDF).

### 4. Tes
```bash
node dev-tests/cetak-kalender.js   # 91 cek (+): kartu 16px/6px, kepala kartu flex + hari efektif,
                                   # Sen…Min, sel berwarna penuh + label, font Inter, cakupan tahun vs semester,
                                   # modal opsi cetak → URL cakupan+orientasi, kartu jadwal tanpa kelas/tingkat
node dev-tests/monitor.js          # 82 cek (disesuaikan: sel berwarna + label, warna latar, grid center, Word)
node dev-tests/ui-monitor.js       # 57 cek (disesuaikan: modal opsi cetak)
```
Regresi lulus: akademik 103, round19 54, round21 58, wa-jadwal 55, tukar 49, kop 25, print 12, kurikulum 88,
kelas-ta 37, ui-wa-jadwal 29, ui-kop 22, ui-round19 51, ui-round21 49, publik-jadwal 33.
Catatan: `round22`/`ui-round22` gagal bila dijalankan **setelah ~20.30 WIB** (time-lock absensi: sesi uji
20:25–21:05 sudah berakhir) — flaky karena jam, bukan regresi ronde ini.

# Panduan Ringkas edupoin

Dokumen ini menjadi satu-satunya sumber pengetahuan operasional untuk Asisten Panduan edupoin.
Jika sebuah tindakan tidak dijelaskan di sini atau tombol tidak tersedia untuk role pengguna,
arahkan pengguna ke Administrator sekolah; jangan menebak konfigurasi atau isi database.

## Akun guru dan jam mengajar

1. Administrator membuka **Pengguna → Tambah Akun**, mengisi identitas, username, kata sandi, dan role.
2. Buka **Akademik → Jadwal Pelajaran → Mata Pelajaran** untuk membuat mata pelajaran.
3. Tetapkan guru pengampu di Data Master Mata Pelajaran. Guru pada slot jadwal mengikuti data pengampu;
   slot tidak menyediakan pilihan guru bebas.
4. Atur jam mengajar melalui tab **Pemetaan Jam Guru** atau batas beban mengajar pada generator jadwal.
5. Jika satu mata pelajaran memiliki beberapa pengampu, slot hanya dapat memakai salah satu guru yang terdaftar.

Sorotan terkait: `btn-tambah-guru`, `menu-akademik`.

## Kalender Akademik satu tahun

1. Buka **Akademik → Kalender Akademik**.
2. Pastikan tahun pelajaran yang dipilih benar.
3. Tambahkan agenda berdasarkan tanggal dan kategori seperti libur, ujian, kegiatan, atau KBM.
4. Tombol **Cetak / Simpan PDF** membuka opsi cakupan tahun atau semester dan orientasi portrait/landscape.
5. Pada dokumen yang terbuka, gunakan dialog cetak browser lalu pilih **Simpan sebagai PDF**.

Sorotan terkait: `menu-akademik`, `btn-cetak-kalender`.

## Matriks jadwal custom

1. Buka **Akademik → Jadwal Pelajaran → Mata Pelajaran** dan siapkan mapel serta guru pengampu.
2. Pada tab **Matriks Jadwal**, pilih kelas dan klik slot kosong untuk membuat jadwal.
3. Atur sesi umum di **Pengaturan Jadwal**. Hari tertentu dapat menggunakan sesi khusus per hari.
4. Pindahkan slot dengan drag-and-drop bila diperlukan. Konflik kelas/guru dan waktu istirahat adalah konflik keras;
   beberapa batas beban atau ruang memerlukan konfirmasi sesuai pesan aplikasi.
5. Tab **AI Timetable Generator** membuat pratinjau; jadwal baru tersimpan setelah tombol Terapkan ditekan.
6. Gunakan **Cetak / PDF** atau **Export Excel** untuk mengunduh matriks dan rincian jadwal.

Sorotan terkait: `menu-akademik`, `btn-tambah-jadwal`, `btn-generate-ai`, `btn-cetak-jadwal`.

## Cetak dokumen

- Pada Kalender Akademik, pilih **Cetak / Simpan PDF**, atur cakupan dan orientasi, lalu buka dokumen.
- Pada Jadwal Pelajaran, pilih tampilan matriks terlebih dahulu, kemudian tekan **Cetak / PDF**.
- Pada laporan, absensi, dan dokumen BK, gunakan tombol **Cetak/PDF** pada halaman terkait.
- Simpan dokumen melalui opsi **Simpan sebagai PDF** pada dialog cetak browser.

Sorotan terkait: `btn-cetak-kalender`, `btn-cetak-jadwal`.

## Pendaftaran sekolah dengan OTP WhatsApp

1. OTP aktif secara bawaan. Super Admin dapat mengatur sakelarnya di **Branding Sistem → Pendaftaran & Proteksi Anti-Spam**.
2. Jika OTP aktif, pastikan gateway WhatsApp pada **Super Admin → WhatsApp Gateway** sudah benar.
3. Pada formulir **Daftarkan sekolah**, isi nomor WhatsApp, tekan **Kirim Kode OTP WhatsApp**, lalu masukkan kode 6 digit. Kode berlaku 5 menit dan hanya dapat dipakai satu kali.
4. Jika gateway bermasalah, Super Admin dapat menonaktifkan OTP pada sakelar tersebut. Pendaftaran tetap dilindungi batas pendaftaran, honeypot, dan reCAPTCHA bila aktif.

## Absensi guru, absensi siswa, dan jurnal

1. Guru membuka **Akademik → Absensi Guru Mapel** dan memilih sesi hari ini.
2. Check-in Hadir/Sakit/Izin hanya tersedia di waktu yang ditetapkan. Sakit/Izin memerlukan alasan.
3. Untuk status Hadir, selesaikan alur **Absensi Siswa → Jurnal → Foto** sebelum batas waktu. Sesi yang ditutup tidak dapat diubah.
4. Absensi siswa per mata pelajaran dibuka dari menu **Absensi Siswa per Mapel** dengan memilih sesi jadwal.
5. Setelah check-in, tombol **Lanjutkan: Absensi → Jurnal → Foto** pada kartu sesi membuka alur jurnal mengajar.
   Lengkapi absensi siswa lebih dahulu bila tombol memberi peringatan, lalu simpan materi dan foto yang diwajibkan.

Sorotan terkait: `btn-checkin-guru`, `btn-absensi-siswa`, `btn-jurnal-mengajar`.

## WhatsApp Fonnte

1. Administrator membuka **Pengaturan → WhatsApp Gateway**.
2. Pilih penyedia **Fonnte**, gunakan URL `https://api.fonnte.com/send`, dan isi token device pada kolom token gateway.
3. Simpan pengaturan dan gunakan tombol uji koneksi bila tersedia.
4. Fitur notifikasi otomatis Alfa/Bolos siswa dan Sakit/Izin guru memiliki sakelar serta template terpisah.
5. Token Fonnte adalah rahasia. Jangan kirim token melalui chatbot atau membagikannya kepada pengguna lain.

Sorotan terkait: `btn-fonnte-wa`.

## ID elemen untuk panduan interaktif

ID berikut diizinkan untuk aksi **Tunjukkan Tombolnya**. Jawaban chatbot hanya boleh menyarankan ID yang tersedia
dan sesuai hak akses pengguna:

`menu-akademik`, `btn-tambah-jadwal`, `btn-cetak-jadwal`, `btn-generate-ai`,
`btn-cetak-kalender`, `btn-checkin-guru`, `btn-absensi-siswa`,
`btn-jurnal-mengajar`, `btn-fonnte-wa`, `btn-tambah-guru`,
`btn-tambah-kelas`, `btn-tambah-siswa`.

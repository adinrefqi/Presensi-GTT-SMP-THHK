# Progres — Presensi GTT SMP THHK

Catatan kerja. Diperbarui: **20 September 2026**.

---

## Tentang aplikasi

PWA satu halaman untuk presensi & hitung honorarium Guru Tidak Tetap SMP THHK Tegal.
Vanilla JS tanpa framework, backend Supabase (PostgREST), fallback `localStorage` saat offline.

| File | Isi |
|---|---|
| `index.html` | Seluruh UI: login screen + 6 `<section class="tab-content">` |
| `app.js` | Semua logika — state, auth, render, cetak, akses Supabase |
| `style.css` | Tema light/dark via `data-theme`, layout cetak |
| `sw.js` | Service worker: network-first aset lokal, stale-while-revalidate CDN |
| `supabase_setup.sql` | Skema awal + seed 9 guru & 2 admin |
| `supabase_migration_security.sql` | bcrypt (pgcrypto), RPC login, RLS awal, view `teachers_safe` |
| `supabase_migration_rls_lockdown.sql` | **Baru** — sesi bertoken, semua akses data lewat RPC |
| `build.mjs` | `vite build` lalu copy aset mentah ke `dist/` |

**Model data:** `admins` · `teachers` (id = NUPTK) · `attendance` (UNIQUE `teacher_id`+`date`) · `settings` (satu baris) · `app_sessions` (baru).

**Rumus gaji:**
```
honorJP   = ΣJP(status = Hadir) × rate
transport = jumlah hari Hadir × transport
total     = honorJP + transport
```

---

## Status temuan

| # | Temuan | Status |
|---|---|---|
| 0 | **Semua password asli ada di repo GitHub publik** | **Terbuka — prioritas tertinggi** |
| 1 | Login guru cuma password, pencocokan nama di browser | **Tidak diubah** (keputusan pemilik) |
| 2 | RLS `USING (true)` — anon bisa baca/tulis/hapus semua tabel | **Selesai** — BAGIAN 7 menyusul |
| 3 | Hash password terkirim ke browser | **Selesai** |
| 4 | Service worker di-unregister tiap load | **Selesai** |
| 5 | Kredensial admin hardcode di `app.js` | Terbuka |
| 6 | `login()` tanpa timeout/retry, blok fallback dead code | **Selesai** lewat #2, sisanya di #5 |
| 7 | Rumus gaji diduplikasi di 5 tempat | Terbuka |
| 8 | `git log` tidak terbaca (`dubious ownership`) | **Selesai** |
| 9 | Payload `app_bootstrap` 6,34 MB bikin login admin timeout | **Selesai** |
| 10 | `alert()` di jalur error membekukan seluruh aplikasi | Terbuka |
| 11 | `pwa-icon.png` & `school-logo.png` masing-masing 1,5 MB | Terbuka |
| 12 | Tanda tangan ikut terkirim tiap login (payload 718 KB) | **Selesai** |
| 13 | Backup JSON bisa memotret data rusak; Restore tak pernah ke server | **Selesai** |
| 14 | Perangkat di lapangan menjalankan `app.js` lama dari cache | **Selesai** (mitigasi) |
| 15 | `rate` & `transport` semua guru 0 — honorarium terhitung Rp 0 | **Terbuka** |
| 16 | Kontras mode gelap gagal — tombol utama berasio 2,06 (AA butuh 4,5) | **Selesai** |
| 17 | Tahun rekap dikunci 2026–2028 di markup | Terbuka |
| 18 | Data demo tetap masuk `state` saat penyimpanan lokal kosong | Terbuka |
| 19 | Tidak ada jejak siapa menginput/mengubah presensi | Terbuka |
| 20 | Tarif tidak dibekukan — honor periode lama ikut berubah | Terbuka |
| 21 | Tidak ada periode terkunci — bulan yang sudah dibayar masih bisa disunting | Terbuka |

---

## #0 — Semua password asli ada di repo GitHub publik

Ditemukan 18 September 2026, setelah #2 terpasang. **Ini yang paling berisiko sekarang.**

`https://github.com/adinrefqi/Presensi-GTT-SMP-THHK` berstatus **publik** (diverifikasi).
`supabase_setup.sql` di dalamnya memuat password asli dalam teks polos:

- Admin (`admin` dan `elsa`): `admin1122`
- Kesembilan guru: `anom312`, `brigita815`, `fransiska112`, `ismadi510`, `inggried005`,
  `yunita614`, `atmo225`, `maulana008`, `nita009`

Sejak #2 terpasang, password guru adalah **satu-satunya** hal yang melindungi data — kunci
pintunya sudah bagus, tapi kuncinya terpasang di papan pengumuman.

**Menghapus file dari repo tidak menyelesaikan apa pun**: password itu sudah tercatat di riwayat
commit dan tetap terbaca. Yang menyelesaikan hanya mengganti seluruh password.

**Cara mengganti — tidak perlu kode baru:**

1. Guru: tab **Guru** → Edit tiap guru → tombol 🎲 di sebelah kolom password menghasilkan
   password acak → Simpan. `app_save_teacher` sudah meng-hash otomatis. Catat, lalu sampaikan
   ke guru yang bersangkutan.
2. Admin: jalankan di Supabase SQL Editor (jangan disimpan ke repo):
   ```sql
   SELECT public.update_admin_password('admin', '<password baru>');
   SELECT public.update_admin_password('elsa',  '<password baru>');
   ```
3. Sesudah semua diganti, sunting `supabase_setup.sql` dan `supabase_migration_security.sql`
   agar memakai placeholder, bukan password asli — supaya tidak terulang.

Pertimbangkan juga menjadikan repo privat, meski itu tidak menggantikan langkah penggantian
password di atas.

---

## Selesai

### #3 — Hash password tidak lagi dikirim ke browser
`app.js` — `loadData()` diubah dari `.from("teachers")` ke `.from("teachers_safe")`.

Kemudian tergantikan oleh #2: pembacaan sekarang lewat `app_bootstrap`, jadi `teachers_safe`
tidak terpakai lagi dan aksesnya dicabut di BAGIAN 7. Viewnya sendiri tidak perlu dihapus.

### #4 — Service worker berhenti dihapus tiap load
`index.html` — blok debug 19 baris yang meng-`unregister()` service worker dan menghapus
seluruh `caches` di tiap load dibuang. Registrasi di bawahnya tetap utuh.

Akibatnya cache `presensi-gtt-v8` sekarang bertahan dan mode offline benar-benar jalan.
`CACHE_NAME` tidak perlu dinaikkan: aset lokal pakai network-first, jadi klien lama tetap
dapat versi terbaru begitu online.

### #2 — Akses langsung anon ke tabel ditutup
Masalahnya: anon key ada di `app.js` (memang publik), dan policy lama memberi anon CRUD penuh.
Siapa pun yang membuka source bisa membaca, mengubah, dan menghapus seluruh data lewat REST
tanpa login.

**`supabase_migration_rls_lockdown.sql` (baru)**
- Tabel `app_sessions` — token UUID, `user_id`, `role`, kedaluwarsa 12 jam. RLS aktif tanpa
  policy sama sekali, jadi anon tidak bisa menyentuhnya; hanya fungsi `SECURITY DEFINER` yang bisa.
- `verify_admin_login` / `verify_teacher_login` sekarang menerbitkan token sesi.
- Baca: `app_bootstrap(token)` — satu panggilan, **server yang memfilter**. Admin dapat semua,
  guru hanya datanya sendiri.
- Tulis: `app_save_attendance`, `app_delete_attendance`, `app_bulk_insert_attendance`,
  `app_save_teacher`, `app_delete_teacher`, `app_save_settings`, `app_reset_data`, `app_logout`.
  Guru hanya boleh menulis/menghapus presensi dirinya sendiri; guru/pengaturan/reset admin saja.
- Semua fungsi `SECURITY DEFINER` + `SET search_path = public`. EXECUTE dicabut dari `PUBLIC`,
  lalu hanya 11 fungsi yang di-`GRANT` ke `anon`.

**`app.js`** — 13 titik akses dipindah ke RPC (bersih −36 baris). Tidak ada lagi `.from("...")`.
Token disimpan di `sessionStorage`; sesi kedaluwarsa memicu logout otomatis.

**Yang sudah diuji** (Postgres 17, di database lain — bukan produksi):
- Pencocokan nama guru di SQL cocok 100% dengan perilaku JS lama untuk ke-9 guru, termasuk
  "WS. Inggried" yang tetap menerima `ws` maupun `inggried`, dan menolak username lain.
- Agregasi `app_bootstrap` (urutan nama, tabel kosong → `[]`) dan konversi jsonb bulk-insert.
- **Ke-13 fungsi terkompilasi bersih** (dijalankan di dalam transaksi lalu `ROLLBACK`,
  jadi tidak ada objek yang tersimpan).

Yang belum diuji: perilaku runtime fungsi-fungsi itu terhadap data nyata — baru terbukti
saat login pertama setelah dipasang.

**Bug yang sudah diperbaiki saat pemasangan:**

1. `42601: unrecognized RAISE statement option` — `RAISE ... USING HINT = 'teks %', arg` ditolak
   Postgres. Daftar argumen `%` hanya untuk string format utama `RAISE`, bukan untuk ekspresi
   di `USING`. Diganti `format('... %s.', p_role)`.
2. `42883: function crypt(text, character varying) does not exist` — di Supabase, pgcrypto
   terpasang di schema **`extensions`**, bukan `public`. Pengetatan `SET search_path = public`
   membuat `crypt()` dan `gen_salt()` tidak terlihat. Fungsi lama tidak kena karena tidak punya
   `SET search_path` sama sekali. Diperbaiki jadi `SET search_path = public, extensions` di
   ke-13 fungsi, plus cast `::text` pada argumen kedua `crypt()`.

   Catatan: ini juga berlaku untuk `app_save_teacher`, yang memanggil `upsert_teacher_with_hash`.
   Fungsi lama itu tidak punya `SET search_path` sendiri, jadi mewarisi milik pemanggil —
   tanpa `extensions` ia ikut gagal.

**Uji runtime (data bcrypt asli, database lain):**

| Kasus | Hasil |
|---|---|
| Login admin, password benar / salah | 1 sesi / 0 sesi |
| Login guru `ismadi` password benar / salah | 1 sesi / 0 sesi |
| Login `ws` dan `inggried` untuk "WS. Inggried" | keduanya 1 sesi |
| Login `inggried` pakai password guru lain | 0 sesi |
| `app_bootstrap` sebagai admin | 2 guru, 3 presensi |
| `app_bootstrap` sebagai guru Ismadi | 1 guru (dirinya), 2 presensi (miliknya) |
| Guru menyimpan presensi sendiri | tersimpan |

Semua objek uji sudah dihapus setelahnya.

**Catatan `STABLE`:** `app_bootstrap` dan `_app_require` berlabel `STABLE`, jadi memakai snapshot
awal statement. Login dan pengambilan data **harus berupa dua request terpisah** — dan memang
begitu di aplikasi. Jangan digabung dalam satu statement SQL, sesinya tidak akan terlihat.

---

## Cara memasang #2 — urutan tidak boleh dibalik

- [x] 1. Jalankan **BAGIAN 1–6** `supabase_migration_rls_lockdown.sql` di Supabase SQL Editor.
- [x] 2. Deploy `app.js` + `index.html` versi baru — terpasang di Vercel
      (`smpthhkpresensi.vercel.app`, dari GitHub). Diverifikasi langsung di browser: ketujuh
      jalur data memakai RPC, blok debug SW sudah hilang, service worker terdaftar & bertahan,
      tidak ada error console.
- [x] 3. Uji login admin **dan** guru, lalu simpan satu data presensi — **semua berhasil**,
      guru hanya melihat datanya sendiri.
- [ ] 4. Buka komentar **BAGIAN 7** (pencabutan akses anon) dan jalankan. ← **belum dikonfirmasi**

Sampai BAGIAN 7 dijalankan, celah #2 masih terbuka: anon key di source masih bisa membaca,
mengubah, dan menghapus seluruh tabel secara langsung. Kode barunya sudah tidak memakai jalur
itu, tapi jalurnya sendiri belum ditutup.

Kalau BAGIAN 7 dijalankan sebelum langkah 2, aplikasi langsung berhenti bekerja.

⚠️ **Langkah 1 dan 2 harus berurutan langsung, jangan diberi jeda lama.** BAGIAN 2 menghapus
`verify_teacher_login(text)` yang lama dan menggantinya dengan versi dua argumen. Begitu
BAGIAN 1–6 sukses, `app.js` lama tidak bisa lagi melayani **login guru** (login admin masih
jalan sampai BAGIAN 7). Jadi ada jendela waktu di mana guru tidak bisa masuk sampai `app.js`
baru ter-deploy.

Verifikasi sesudah langkah 4 — query ini harus **gagal/kosong** bagi anon:
```sql
SELECT * FROM public.teachers;
```
dan ini harus tetap bekerja:
```sql
SELECT * FROM verify_admin_login('admin', '<password>');
```

### Perubahan perilaku yang akan terasa
- Semua orang login ulang sekali setelah deploy; sesi berakhir tiap 12 jam.
- HP guru tidak lagi mengunduh data seluruh sekolah (dulu terunduh, hanya disembunyikan UI).
- Auto-isi data demo saat tabel guru kosong **dihapus**. Sekarang hanya lewat tombol
  "Muat Data Demo" di tab Pengaturan. Ini perlu: jalur lama bisa terpicu gangguan jaringan
  biasa dan mengosongkan database produksi.
- Login guru saat Supabase tak terjangkau tidak lagi bisa (dulu lolos **tanpa verifikasi
  password sama sekali**).
- Yang diketik guru di layar login tidak berubah: tetap nama depan + password.

---

## Keputusan

**#1 tidak diubah.** Login guru tetap nama depan + password, tanpa penguatan lain, karena para
guru sudah terbiasa dengan cara ini.

Konsekuensi yang perlu diingat: password guru adalah satu-satunya rahasia yang melindungi data,
dan pembatas 5× percobaan masih di sisi browser — pemegang anon key masih bisa menebak password
ke RPC login tanpa batas. Penguatan #2 tidak menghilangkan celah ini, hanya membatasi kerusakan
kalau satu akun jebol.

Pencocokan nama guru tetap dipindah ke server sebagai bagian dari #2, karena server harus tahu
token diterbitkan untuk guru yang mana. Input yang diketik guru tidak berubah.

---

## Sisa pekerjaan

~~Urutan yang disarankan: **#0 → #5 → #7**.~~ — digantikan oleh
[Urutan yang disarankan](#urutan-yang-disarankan) di akhir dokumen, sesudah temuan #15–#21
masuk. Rincian tiap temuan di bawah ini tetap berlaku.

### #5 — Kredensial hardcode & login offline tanpa verifikasi

| | |
|---|---|
| Lokasi | `app.js:945` dan `app.js:953` (cabang fallback saat Supabase tak terjangkau), plus cabang lokal di `checkTeacherCredentials` |
| Masalah | `admin` / `elsa` + `admin1122` tertulis polos. Cabang guru lebih buruk: saat offline, siapa pun bisa masuk sebagai guru mana pun **tanpa verifikasi password sama sekali** |
| Perbaikan | Hapus kedua cabang, ±20 baris. Murni penghapusan, tanpa pengganti |
| Konsekuensi | Tidak ada lagi login offline. Praktis sudah begitu sejak #2 — tanpa token data memang tidak bisa diambil, jadi cabang itu kini hanya menghasilkan aplikasi kosong yang gagal di tiap penyimpanan |
| Risiko | Rendah |

Catatan: #5 membersihkan password dari source, tetapi **tidak menggantikan #0** — password yang
sama sudah terlanjur ada di riwayat commit publik.

### #6 — Sisa di `login()`

Selesai lewat #2: RPC login sekarang lewat `runSupabaseRequest` (punya timeout & retry), dan blok
fallback dead code yang meng-`SELECT` kolom password dari `admins` sudah dibuang. Yang tersisa
hanya jalur fallback lokal, yang ditangani #5.

### #7 — Rumus gaji terduplikasi

Diperiksa ulang: bukan 4 tempat, tapi **5**.

| Lokasi | Fungsi |
|---|---|
| `app.js:1713` | `printTeacherHistory` |
| `app.js:2348` | `renderRekapTable` |
| `app.js:2391` | `generateSlipGaji` |
| `app.js:2618` | `generatePrintRekapGaji` |
| `app.js:2903` | `exportRecapToCSV` |

**Perbaikan:** satu fungsi `hitungHonor(teacher, logs)` yang mengembalikan jumlah
hadir/sakit/izin/alpa, total JP, honor JP, uang transport, dan totalnya. Lima pemanggil memakai
itu. Bersih sekitar −40 baris.

**Risiko:** rendah, tapi menyentuh slip gaji, dua laporan cetak, dan CSV — perlu sekali
pemeriksaan visual hasil cetak untuk memastikan angkanya tidak berubah.

~~**Nilainya hari ini: nol.** Tidak ada bug, hasilnya identik. Baru terasa saat rumusnya berubah
(potongan, tunjangan, pajak). Kalau belum ada rencana itu, tunda saja.~~

**Tidak lagi nol — lihat #20.** Kesimpulan di atas ditulis sebelum diketahui bahwa tarif tidak
pernah dibekukan di baris presensi. Pembekuan tarif harus dikerjakan di tempat honor dihitung,
dan tempat itu ada lima. Menyatukannya lebih dulu berarti pekerjaan itu dilakukan sekali.

### #8 — git tidak terbaca — SELESAI

Sudah dijalankan 18 September 2026:
```
git config --global --add safe.directory 'D:/aplikasi/scratch/Presensi THHK GTT'
```

**Catatan lepas (belum jadi temuan bernomor):** tombol Restore JSON di tab Pengaturan hanya
menulis ke state & `localStorage`, tidak pernah ke Supabase — sehingga hasil restore tertimpa
begitu halaman dimuat ulang. Perilaku ini sudah ada sejak sebelum perubahan di atas.

---

## #9 — Payload `app_bootstrap` 6,34 MB bikin login admin timeout — SELESAI

Ditemukan dan diperbaiki 20 September 2026, setelah laporan "login admin tidak bisa masuk,
jadi timeout".

**Gejalanya menyesatkan.** Login-nya sebenarnya *berhasil* — `verify_admin_login` menjawab
0,77 dtk. Yang gagal `fetchDataFromSupabase()` sesudahnya, sehingga admin masuk ke aplikasi
kosong: dashboard menampilkan "0 dari 9 Guru". Supabase sehat, bundle di Vercel identik dengan
lokal, service worker bersih — ketiganya sempat dicurigai dan ketiganya tidak bersalah.

**Sebabnya** `app_bootstrap` (`supabase_migration_rls_lockdown.sql:151-156`) menarik seluruh
tabel presensi **berikut kolom `signature`**, setiap kali login dan setiap refresh. Guru tidak
terkena karena hanya menerima barisnya sendiri; admin menerima semuanya.

Diukur langsung di produksi:

| | Sebelum | Sesudah |
|---|---|---|
| Payload `app_bootstrap` (admin) | 6,34 MB | **0,70 MB** |
| Rata-rata 1 tanda tangan | 42,4 KB PNG 1293×506 | **4,4 KB WebP 360×141** |
| Porsi tanda tangan dari payload | 99,5% | — |
| Data termuat saat login | 126 baris lokal (cadangan) | **161 baris dari server** |

Tanda tangan tersimpan 1293×506 piksel karena kanvas 460×180 (`index.html:464`) dikalikan
`devicePixelRatio` (~2,8×), padahal hanya ditampilkan setinggi ~28 px dan ~25 px saat dicetak.

**Perbaikan** (commit `425d273` dan `5b300b5`):

1. `app.js:629` — `toDataURL()` mengekspor lewat kanvas antara 360 px sebagai WebP q0,72,
   dengan fallback PNG bila browser mengabaikan `image/webp` (Safari lama).
2. Migrasi sekali-jalan 155 tanda tangan lama lewat browser: **155/155 berhasil, nol gagal**,
   6,31 MB → 0,67 MB (hemat 89,4%). Postgres tidak bisa transcode gambar, jadi migrasi harus
   lewat kanvas di sisi klien.
3. `app.js:183` — timeout sempat dinaikkan 15 → 45 dtk sebagai tambalan, lalu **diturunkan ke
   20 dtk** setelah payload mengecil.

**Sempat dibatalkan, lalu tetap dikerjakan.** Mengeluarkan kolom `signature` dari
`app_bootstrap` awalnya dibatalkan dengan alasan "payload sudah 0,70 MB, tidak sepadan". Alasan
itu keliru: ia mengandaikan ukuran payload satu-satunya faktor. Beberapa jam kemudian login
gagal lagi, dan pengukuran streaming menunjukkan sebabnya — TTFB hanya 4,6 dtk tapi transfer
718 KB butuh 56 dtk, yaitu **12,8 KB/detik di koneksi pemakai**. Server sehat (diuji dari
koneksi lain: Supabase TTFB 0,82 dtk, Vercel 1,68 MB/dtk). Jadi dikerjakan, lihat #12.

**Catatan untuk ke depan:** tambalan timeout 45 dtk **tidak menyelamatkan** — muatan tetap gagal
di 91 dtk (45 + 0,6 + 45). Yang menyelesaikan hanya pengecilan payload. Jangan ulangi menaikkan
timeout sebagai solusi.

### #10 — `alert()` di jalur error membekukan seluruh aplikasi

`app.js:415` memanggil `alert()` saat gagal mengambil data. Dialog modal browser memblokir
seluruh halaman sampai diklik — aplikasi tampak menggantung, bukan gagal dengan anggun. Saat
menelusuri #9 hal ini tiga kali tersalah-baca sebagai "renderer beku".

**Perbaikan:** pakai sistem toast yang sudah ada (commit `ec66d69`) menggantikan `alert()`.
Periksa juga pemanggilan `alert()` lain di `app.js` — pola yang sama kemungkinan tersebar.

### #11 — Dua PNG 1,5 MB ikut diunduh tiap kali halaman dimuat

`pwa-icon.png` dan `school-logo.png` masing-masing **1.555.425 byte**, padahal ditampilkan kecil
(logo sidebar dan ikon PWA). Keduanya masuk daftar `ASSETS_TO_CACHE` di `sw.js`.

Ini diduga ikut andil di #9: saat halaman dimuat, permintaan 6,34 MB berebut bandwidth dengan
~3 MB PNG plus tiga skrip CDN. Statusnya **dugaan, belum dibuktikan** — yang pasti hanya bahwa
ukurannya jauh di atas kebutuhan tampilan.

**Perbaikan:** kecilkan ke ukuran tampil sebenarnya (ikon PWA cukup 512×512), harusnya turun ke
puluhan KB.

### #12 — Tanda tangan keluar dari `app_bootstrap` — SELESAI

Lanjutan #9. Sesudah kompresi, payload login masih 718 KB dan itu tetap terlalu berat di
koneksi 12,8 KB/detik. Perbaikannya memindahkan tanda tangan keluar dari muatan login.

- `supabase_migration_signature_lazy.sql` — `app_bootstrap` tidak lagi mengirim `signature`;
  fungsi baru `app_get_signatures(p_token, p_ids)` mengambilnya per permintaan, dengan
  penyaringan peran yang sama persis (admin semua, guru hanya miliknya).
- `app.js` — `ensureSignatures(logs)` dipanggil di enam tempat pemakai. Konvensinya:
  `undefined` berarti belum diambil, `''` berarti sudah diperiksa dan memang tidak ada.
  Saat pengambilan gagal, baris **tidak** ditandai kosong supaya dicoba lagi nanti.
- Dua jalur cetak dan slip gaji **menunggu** tanda tangan sebelum merender, supaya dokumen
  honorarium tidak pernah tercetak tanpa TTD.

Hasil terukur di produksi:

| | Sebelum | Sesudah |
|---|---|---|
| `app_bootstrap` | 718 KB / 56 dtk | **33 KB / 1,7 dtk** |

Diverifikasi lewat UI: Histori Guru menampilkan thumbnail TTD normal, dan sesudah login hanya
6 tanda tangan yang ditarik — yaitu baris yang sedang tampil.

**Catatan penting soal timeout.** `SUPABASE_REQUEST_TIMEOUT_MS` sengaja dibiarkan di 60 detik.
Hari ini nilainya sempat diturunkan ke 20 dtk atas dasar "payload sudah kecil", dan itu
langsung memblokir login pemilik. Jangan perketat timeout demi kerapian; ia batas atas, bukan
penundaan, dan tidak memperlambat apa pun ketika jaringan sedang sehat.

### #13 — Backup bisa memotret data rusak, dan Restore tak pernah sampai ke server — SELESAI

Ditemukan 20 September 2026 saat memverifikasi keutuhan data. Dua cacat terpisah yang bersama-
sama membuat cadangan terasa aman padahal tidak.

**Backup memotret `state`.** Kalau pengambilan data dari server sedang gagal, aplikasi jatuh ke
`loadSampleData()` (`app.js:452`), dan Backup JSON mengekspor **data demo** itu. Tiga berkas
cadangan yang diambil hari ini berisi 126 baris berpola `sample_` tanpa satu pun tanda tangan,
sementara data asli 161 baris dengan 155 tanda tangan. Pemilik mengira sudah punya cadangan.

**Restore tidak pernah menulis ke Supabase.** `importRestoreJSON()` (`app.js:2550`) hanya
mengisi `state` dan `localStorage`, lalu menampilkan "Restorasi database berhasil dilakukan!".
Begitu halaman dimuat ulang, `app_bootstrap` menimpanya. Pesan suksesnya menyesatkan.

**Perbaikan yang dikerjakan** (commit `2c571cf` dan `9e4e53b`):

*Backup* kini mengambil langsung dari server lewat `app_bootstrap`, bukan dari `state`, lalu
menarik seluruh tanda tangan — cadangan tanpa TTD tidak berguna untuk pemulihan. Kalau server
tidak bisa dihubungi, aplikasi **menolak menerbitkan berkas** daripada menghasilkan cadangan
yang salah isi. Berkas memakai `Blob`, bukan `data:` URI yang punya batas panjang URL, dan
membawa metadata `versi`, `dibuat_pada`, `sumber`, serta jumlah baris.

*Restore* memakai fungsi SQL baru `app_restore_attendance` (`supabase_migration_restore.sql`)
dan memegang empat aturan:

1. **Tidak pernah menghapus.** Hanya menambah dan memperbarui, sehingga memulihkan cadangan
   lama tidak bisa menghilangkan data yang lebih baru.
2. Tanda tangan lama dipertahankan bila cadangan tidak membawanya (`COALESCE`).
3. Baris yang bentrok guru+tanggal dengan presensi lain ber-ID berbeda **dilewati**, bukan
   ditimpa, dan jumlahnya dilaporkan balik supaya tidak hilang diam-diam.
4. Satu pernyataan SQL: kalau gagal, tidak ada yang tertulis.

Guru dipulihkan lebih dulu karena `attendance.teacher_id` punya foreign key ke `teachers`.
Password guru tidak tersentuh (`p_password` kosong). `alert()` diganti `showToast()`.

**Penjaga data demo sempat terlalu galak.** Versi pertama menolak berkas bila >70% ID
berawalan `sample_`. Uji di produksi menunjukkan itu keliru: data asli memuat 6 baris
`sample_` tertanggal 30 Juni, sisa muat demo lama yang kini bagian data nyata. Syaratnya
diperketat jadi dua sekaligus — mayoritas ID `sample_` **dan** nol tanda tangan. Tanda tangan
adalah pembeda sebenarnya: data `loadSampleData()` tidak pernah punya, data asli punya.
Cadangan terbitan versi 2 ke atas dipercaya langsung.

**Hasil uji di produksi**, semuanya tanpa satu pun baris yang hilang atau berubah:

| Uji | Hasil |
|---|---|
| Berkas data demo murni (126 baris `sample_`, nol TTD) | ditolak |
| Berkas sampah tanpa daftar guru/presensi | ditolak |
| Cadangan penuh 162 baris / 156 TTD | diterima |
| Cadangan bentuk lama (`teacherId`) | diterima |
| Pulihkan 3 baris tanpa TTD | 0 ditambah, 3 diperbarui, **TTD utuh** (4531/3615/4263 byte) |
| Baris bentrok guru+tanggal ber-ID baru | **1 dilewati, 0 ditambah** |
| Jumlah data sesudah seluruh uji | tetap 162 baris, 9 guru |

**Tombol Backup sudah diuji manual oleh pemilik** pada 20 September 2026. Berkas terbit
762,4 KB, dan isinya diperiksa — bukan hanya ukurannya, karena berkas 32 KB kemarin juga
"berhasil" terbit:

| | |
|---|---|
| Penanda | `versi: 2`, `sumber: "server"` |
| Metadata tertulis | 9 guru, 162 presensi, 156 bertanda tangan |
| Isi sebenarnya | 9 guru, 162 presensi, 156 bertanda tangan — cocok |
| Format tanda tangan | 155 WebP + **1 PNG** |
| Bentuk kolom | `teacher_id` (bentuk server) |

Satu PNG di antaranya adalah presensi pukul 13.46 dari perangkat bercache lama (#14). Ini
sekaligus penanda berguna: kalau cadangan berikutnya sudah 100% WebP, perangkat itu sudah
memperbarui diri.

**Tombol Restore belum diuji manual.** Logika di baliknya sudah diuji langsung lewat RPC
(lihat tabel di atas), yang tersisa hanya jalur pilih-berkas di browser.

### #14 — Perangkat di lapangan menjalankan `app.js` lama dari cache — SELESAI (mitigasi)

Ditemukan 20 September 2026. Presensi yang diinput pukul 13.46 — jauh sesudah kompresi WebP
ter-deploy — tanda tangannya tetap tersimpan sebagai **PNG 1293x506 berukuran 34,7 KB**, bukan
WebP 360px ~4 KB. Perangkat yang menginputnya masih menjalankan bundle lama.

Sebabnya strategi network-first di `sw.js` jatuh ke cache begitu `fetch` gagal
(`.catch(() => caches.match(...))`), dan di koneksi lambat itu sering terjadi.

**Mitigasi:** `CACHE_NAME` dinaikkan ke `presensi-gtt-v9`, sehingga handler `activate`
menghapus cache lama pada muatan berhasil berikutnya. Disebut mitigasi, bukan penyelesaian:
perangkat yang tidak pernah berhasil menjangkau jaringan tetap menjalankan kode lama, dan itu
memang sifat PWA. Kalau ke depan ada perubahan yang wajib serentak, naikkan `CACHE_NAME`
sebagai bagian dari perubahan itu.


### #15 — `rate` dan `transport` semua guru bernilai 0

Ditemukan 20 September 2026 saat memverifikasi keutuhan data. Kesembilan guru punya
`rate = 0` dan `transport = 0` di server, sehingga seluruh perhitungan honorarium
menghasilkan **Rp 0** — terlihat di kartu "Estimasi Honor" pada dashboard, di slip gaji, dan
di rekap.

**Bukan akibat pekerjaan 20 September.** Berkas cadangan jam 12.20, yang diambil sebelum
migrasi tanda tangan jam 12.38, sudah menunjukkan `rate` 0. Jadi kondisi ini sudah ada
sebelumnya. Nilai seed awal di `supabase_setup.sql` adalah 45.000–55.000 untuk rate dan
20.000–25.000 untuk transport.

**Perbaikan:** isi ulang lewat tab Data Guru GTT. Tidak perlu SQL.

**Jebakan yang menyertainya — penting.** Restore menimpa `rate` dan `transport` guru dengan
nilai dari berkas cadangan. Cadangan 762 KB tertanggal 20 September merekam `rate = 0` apa
adanya. Artinya bila tarif sudah dibetulkan lalu suatu saat berkas itu dipulihkan, tarifnya
kembali nol. Data presensi tidak terpengaruh; yang berisiko hanya data guru.

Urutan yang benar: betulkan tarif dulu, **lalu ambil cadangan baru**, dan jadikan berkas baru
itu pegangan. Berkas 762 KB disimpan sebagai cadangan presensi saja.

---

## Pemetaan fitur — 20 September 2026

Pertanyaan pemilik: fitur apa yang perlu ditambahkan. Seluruh UI dan model data dipetakan
untuk menjawabnya.

**Kesimpulannya: alur kerjanya sudah lengkap.** Enam tab, delapan jalur cetak/ekspor, slip
gaji, tanda tangan, filter per bulan, peran admin/guru dipagari di server. Tidak ada tombol
mati, tidak ada `TODO`, tidak ada fungsi yang didefinisikan tapi tak pernah dipanggil.
Fitur terakhir ditambahkan 28 Juli 2026; seluruh kerja sejak 18 September murni keamanan,
kinerja, dan keutuhan data.

Yang kurang bukan fitur, melainkan **jaminan di sekitar uangnya** — dicatat sebagai #19, #20,
dan #21. Ketiganya bermuara di satu tempat, `app_save_attendance`, yang sudah memegang
`s.user_id` untuk pemeriksaan izin.

**Satu ide yang gugur sebelum diusulkan:** input presensi massal satu layar untuk semua guru.
Input presensi memakai tanda tangan per guru (`index.html:464`), dan tanda tangan itulah bukti
keabsahannya — input massal oleh admin justru membuang bukti tersebut.

---

## #16 — Kontras mode gelap gagal, dan penyegaran tampilan — SELESAI

Dikerjakan 20 September 2026. Commit `bb86a1c` dan `4afc584`. Lingkup sengaja dibatasi pada
`style.css` plus tujuh nilai warna di `app.js`; struktur, `id`, dan SQL tidak disentuh, sehingga
seluruh pekerjaan keamanan 18–20 September tidak mungkin tergores.

**Cacat yang ditemukan saat mengerjakan — bukan soal selera:**

| | Sebelum | Sesudah |
|---|---|---|
| Tombol utama, mode gelap | **2,06** (putih di atas teal terang) | **8,12** |
| Tombol bahaya, mode gelap | — | **4,60** |
| Status "Hadir" di dokumen cetak | 3,74 | **4,89** |
| Status non-Hadir di dokumen cetak | 3,76 | **4,49** |

Ambang WCAG AA adalah 4,5 untuk teks normal. Jadi tombol "Cetak Rekap Gaji" di mode gelap
selama ini memang **tidak terbaca**, bukan sekadar kurang rapi.

Selain itu:
- Cincin fokus memakai nilai keras hijau tua, nyaris tak terlihat di latar gelap. Kini token
  `--focus-ring` yang ikut tema.
- `--shadow-xs` tidak didefinisikan ulang di blok gelap, jadi bayangan terang dipakai di atas
  latar gelap.
- `--primary-color` dirujuk `app.js:1791` tapi **tidak pernah didefinisikan**, sehingga teks
  "Periode:" di Histori Guru kehilangan warnanya. Ditambahkan sebagai alias di `:root`.
- `--danger-solid` dibuat dan sengaja **tidak** ikut berganti tema: `--danger` versi gelap
  terlalu muda untuk jadi latar tombol berteks putih (rasionya jatuh ke ~2,4).

**Penyegaran:** hue indigo dan biru ditarik mendekat ke teal supaya empat kartu dashboard
terbaca sebagai satu set; radius dan kepadatan naik sedikit di desktop (`@media 768px` sudah
menimpa ketiganya, jadi tampilan HP tidak berubah); bayangan dimatikan di mode gelap karena di
sana tepi yang bekerja; `tabular-nums` pada kolom angka dan kartu statistik.

**Penghapusan:** `.btn-success` tidak dipakai di mana pun. Bobot font 500 dilepas dari
`@import` (3 pemakaian dialihkan ke 600) — satu berkas font lebih sedikit, dan itu terasa di
koneksi 12,8 KB/detik pada #9.

**Grafik Chart.js** diwarnai keras dan nilainya sudah tidak cocok dengan `--primary` bahkan
sebelum pekerjaan ini. Sekarang mengikuti palet. **Nilainya dipatok, bukan membaca token CSS** —
`initTheme()` (`app.js:516`) hanya mengganti atribut dan tidak merender ulang grafik, jadi nilai
yang dibaca akan basi begitu tema dibalik. Diuji: lolos ambang WCAG 3,0 untuk elemen non-teks di
kedua latar (teal 5,03 gelap / 3,31 terang; biru 3,98 / 4,19).

**Satu perubahan menyentuh kertas.** `app.js:1952` mengisi `#printRekapArea`, jadi ia bagian
dokumen cetak, bukan layar. Nilainya dipatok dengan alasan terbalik dari biasanya: dokumen
dicetak di atas kertas putih, dan `var(--primary)` akan ikut mode gelap pemakai — teal terang
`#4ec7b8` nyaris tak terbaca di kertas.

**Blok cetak `style.css` tidak disentuh sama sekali** (wilayah `#printRekapArea` dan
`@media print`), diverifikasi lewat rentang baris pada diff.

**Catatan kekeliruan.** Saat mengerjakan, sempat disimpulkan bahwa `var()` di atribut `style`
inline tidak ikut berubah saat tema diganti. **Itu keliru** — metode ukurnya cacat: elemen yang
disuntik lewat `innerHTML` tidak ter-invalidasi, bukan `var()`-nya yang gagal. Uji ulang yang
bersih menunjukkan `var()` inline bekerja normal. Pemindahan gaya tombol histori ke `style.css`
tetap dipertahankan, tapi alasannya sederhana: gaya tempatnya di stylesheet, bukan di string
template.

**Belum diverifikasi, perlu mata pemilik:** keenam tab dengan data asli, tampilan di HP, dan
sekali cetak **Laporan Presensi Individual** untuk memastikan kolom Status terbaca wajar.
Verifikasi dilakukan tanpa login — server dev menunjuk ke Supabase produksi, dan password di
repo justru yang sedang diganti (#0).

`CACHE_NAME` sengaja tidak dinaikkan: aset lokal memakai network-first dan ini bukan perubahan
yang wajib serentak (lihat #14).

---

## #17 — Tahun rekap dikunci 2026–2028

`index.html:344`, `522`, dan `570` memuat daftar tahun sebagai `<option>` tetap. Rekap, histori
guru, dan filter presensi akan buntu di 2029.

**Perbaikan:** bangkitkan daftar tahunnya dari JavaScript, atau cukup rentang bergulir di
sekitar tahun berjalan. Kecil, tapi jangan menunggu sampai Januari 2029.

---

## #18 — Data demo tetap masuk `state` saat penyimpanan lokal kosong

`app.js:488-490` — kalau `state.teachers` kosong sesudah membaca `localStorage`,
`loadSampleData(false)` tetap dipanggil. Catatan #2 menyebut auto-muat demo sudah dihapus; yang
dihapus hanya pengirimannya ke server (`pushToServer` kini `false`), pemanggilannya masih ada.

Akibatnya dashboard bisa menampilkan 9 guru palsu saat gagal mengambil data. Inilah mesin
kebingungan di balik #9 dan #13: gagal ambil data → `alert()` memblokir (#10) → jatuh ke
storage → kosong → data demo.

Tidak lagi berbahaya bagi cadangan sejak #13 (Backup membaca langsung dari server), tapi tetap
menyesatkan di layar.

---

## #19, #20, #21 — Tiga jaminan honorarium yang belum ada

Ditemukan saat pemetaan 20 September 2026. Ketiganya bermuara di satu tempat:
`app_save_attendance` (`supabase_migration_rls_lockdown.sql:173-220`), yang **sudah** memegang
`s.user_id` dan `s.role` untuk pemeriksaan izin — tinggal dipakai.

### #19 — Tidak ada jejak siapa menginput atau mengubah

`attendance` tidak punya kolom pelaku. `created_at` diisi sekali saat INSERT dan tidak ikut
berubah di cabang UPDATE, jadi bahkan **waktu** suntingan tidak tercatat, apalagi pelakunya.

Admin mengubah JP seorang guru — dan JP itu uang — tidak bisa dibedakan dari guru yang
menginput sendiri. Kalau suatu saat ada sengketa honorarium, tidak ada yang bisa dirujuk.

Tanda tangan adalah hal terdekat dengan bukti keabsahan, tapi ia opsional dan pada UPDATE
dipertahankan lewat `COALESCE` bila tidak dikirim ulang — jadi tidak bisa dijadikan bukti
kepengarangan.

**Perbaikan:** satu kolom `entered_by`, diisi dari `s.user_id` yang sudah ada di scope. Murah.

### #20 — Tarif tidak dibekukan

Honor dihitung ulang dari `teachers.rate` **saat ini**, setiap kali ditampilkan, di kelima
tempat yang menduplikasi rumus. Tidak ada satu pun yang menyimpan tarif yang berlaku saat
pekerjaan benar-benar dilakukan.

#15 membuktikan akibatnya: tarif jadi 0, dan seluruh slip bulan-bulan lalu ikut jadi Rp 0.
Hal yang sama terjadi setiap kali tarif dinaikkan — slip tahun lalu diam-diam berubah.

**Perbaikan:** simpan `rate` dan `transport` di baris presensi saat disimpan, dan hitung dari
situ dengan `COALESCE` ke nilai guru untuk baris lama.

**Ini yang membuat #7 berhenti bernilai nol.** Catatan #7 menyimpulkan penyatuan rumus tidak
ada gunanya hari ini karena hasilnya identik. Dengan #20, penyatuan itu jadi prasyarat: satu
fungsi `hitungHonor()` berarti pembekuan tarif dikerjakan sekali, bukan lima kali.

### #21 — Tidak ada periode terkunci

Tidak ada konsep periode di skema sama sekali — tidak ada tabel `periods`, tidak ada penanda
`locked`, tidak ada tahun ajaran. "Periode" di UI murni penyaring bulan/tahun di sisi klien
(`isLogInMonthYear`).

Akibatnya presensi bulan yang honornya **sudah dibayar** masih bisa disunting atau dihapus,
oleh admin maupun oleh guru atas barisnya sendiri. `app_save_attendance` dan
`app_delete_attendance` tidak punya pemeriksaan rentang tanggal.

**Perbaikan termurah:** satu kolom `terkunci_sampai DATE` di tabel `settings`, dan satu
pemeriksaan di kedua fungsi tulis. Tidak perlu tabel periode.

---

## Urutan yang disarankan

1. **#15** — tarif 0. Aplikasi salah hitung setiap hari sampai ini dibetulkan. Isi lewat tab
   Data Guru, **lalu ambil cadangan baru** — cadangan 762 KB yang ada merekam nilai 0.
2. **BAGIAN 7** (`supabase_migration_rls_lockdown.sql:358`) — sampai dijalankan, anon key masih
   bisa membaca, mengubah, dan menghapus seluruh tabel secara langsung.
3. **#0** ganti seluruh password, lalu **#5** hapus kredensial hardcode.
4. **#10** — 29 `alert()` masih ada. `showToast()` sudah menebak jenis pesan sendiri, jadi ini
   nyaris hanya mengganti nama pemanggil. Dahulukan `app.js:417`, yang memblokir tepat saat
   pengambilan data gagal.
5. **#19** — satu kolom, nilainya sudah ada di scope. Termurah di antara tiga jaminan.
6. **#7 + #20** dikerjakan bersama.
7. **#21**, lalu **#11**, **#17**, **#18** kapan saja.

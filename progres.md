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

Urutan yang disarankan: **#0 → #5 → #7**.

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

**Nilainya hari ini: nol.** Tidak ada bug, hasilnya identik. Baru terasa saat rumusnya berubah
(potongan, tunjangan, pajak). Kalau belum ada rencana itu, tunda saja.

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

**Yang sengaja tidak dikerjakan.** Sempat direncanakan mengeluarkan kolom `signature` dari
`app_bootstrap` dan mengambilnya per-baris lewat RPC baru. Dibatalkan karena setelah kompresi
payload tinggal 0,70 MB — tidak sepadan dengan tambahan RPC, cache di klien, dan tiga tempat
render yang harus diubah. Bangun hanya kalau payload kembali melewati ~2 MB.

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

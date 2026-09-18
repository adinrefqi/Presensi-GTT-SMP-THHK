# Progres — Presensi GTT SMP THHK

Catatan kerja. Diperbarui: **18 September 2026**.

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
| 1 | Login guru cuma password, pencocokan nama di browser | **Tidak diubah** (keputusan pemilik) |
| 2 | RLS `USING (true)` — anon bisa baca/tulis/hapus semua tabel | **Selesai (kode)** — tinggal dipasang |
| 3 | Hash password terkirim ke browser | **Selesai** |
| 4 | Service worker di-unregister tiap load | **Selesai** |
| 5 | Kredensial admin hardcode di `app.js` | Terbuka |
| 6 | `login()` tanpa timeout/retry, blok fallback dead code | Sebagian selesai lewat #2 |
| 7 | Rumus gaji diduplikasi di 4 tempat | Terbuka |
| 8 | `git log` tidak terbaca (`dubious ownership`) | Terbuka |

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

- [ ] 1. Jalankan **BAGIAN 1–6** `supabase_migration_rls_lockdown.sql` di Supabase SQL Editor.
- [ ] 2. Deploy `app.js` + `index.html` versi baru.
- [ ] 3. Uji login admin **dan** guru, lalu simpan satu data presensi.
- [ ] 4. Buka komentar **BAGIAN 7** (pencabutan akses anon) dan jalankan.

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

**#5 — Kredensial admin hardcode.** `admin` / `admin1122` tertulis di `app.js` (jalur fallback
saat Supabase tidak dikonfigurasi). Terbaca siapa pun yang membuka source.

**#6 — Sisa di `login()`.** Sudah ikut rapi lewat #2 (RPC login kini lewat `runSupabaseRequest`,
blok fallback dead code yang meng-`SELECT` kolom password dari `admins` sudah dibuang).
Yang tersisa hanya jalur fallback lokal di #5.

**#7 — Rumus gaji diduplikasi di 4 tempat:** `renderRekapTable`, `generateSlipGaji`,
`generatePrintRekapGaji`, `generatePrintRekapPerGuru`. Kalau nanti ada potongan atau tunjangan
baru, keempatnya harus diedit. Satukan jadi satu fungsi hitung.

**#8 — git tidak terbaca.** Perbaiki dengan:
```
git config --global --add safe.directory 'D:/aplikasi/scratch/Presensi THHK GTT'
```

**Catatan lepas (belum jadi temuan bernomor):** tombol Restore JSON di tab Pengaturan hanya
menulis ke state & `localStorage`, tidak pernah ke Supabase — sehingga hasil restore tertimpa
begitu halaman dimuat ulang. Perilaku ini sudah ada sejak sebelum perubahan di atas.

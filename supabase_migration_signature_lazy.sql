-- ============================================================
--  Tanda tangan tidak lagi ikut app_bootstrap
--  Dijalankan: 20 September 2026
-- ============================================================
--
--  MASALAH
--  app_bootstrap mengirim seluruh kolom signature setiap kali login dan setiap
--  refresh. Sesudah kompresi WebP payload-nya 0,70 MB untuk 161 baris — jauh
--  lebih baik dari 6,34 MB sebelumnya, tapi di koneksi lambat (terukur 12,8
--  KB/detik di lapangan) itu tetap berarti hampir satu menit menunggu, dan
--  login gagal di timeout.
--
--  PERUBAHAN
--  1. app_bootstrap tidak lagi mengirim signature  -> payload login ~30 KB.
--  2. Fungsi baru app_get_signatures mengambil tanda tangan hanya untuk baris
--     yang sedang ditampilkan, saat dibutuhkan.
--
--  KEAMANAN DATA
--  Berkas ini TIDAK menyentuh data sama sekali. Tidak ada INSERT, UPDATE,
--  DELETE, TRUNCATE, ALTER TABLE, atau DROP TABLE. Yang diubah hanya definisi
--  fungsi — yakni APA YANG DIKIRIM ke aplikasi, bukan apa yang tersimpan.
--  Aman dijalankan ulang (CREATE OR REPLACE).
--
--  PENYARINGAN PERAN
--  app_get_signatures memakai aturan yang sama persis dengan app_bootstrap:
--  admin boleh semua baris, guru hanya barisnya sendiri. Jangan longgarkan.
-- ============================================================


-- ------------------------------------------------------------
-- 1. app_bootstrap — sama seperti sebelumnya, minus a.signature
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_bootstrap(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.app_sessions;
        v_teachers JSONB;
        v_attendance JSONB;
        v_settings JSONB;
BEGIN
  s := public._app_require(p_token);

  -- Guru hanya menerima datanya sendiri.
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.name), '[]'::jsonb) INTO v_teachers
  FROM (
    SELECT t.id, t.name, t.subject, t.rate, t.transport, t.status
    FROM public.teachers t
    WHERE s.role = 'admin' OR t.id = s.user_id
  ) x;

  -- signature sengaja TIDAK disertakan: diambil belakangan lewat
  -- app_get_signatures hanya untuk baris yang sedang ditampilkan.
  SELECT COALESCE(jsonb_agg(to_jsonb(y)), '[]'::jsonb) INTO v_attendance
  FROM (
    SELECT a.id, a.teacher_id, a.date, a.status, a.jp, a.class, a.topic
    FROM public.attendance a
    WHERE s.role = 'admin' OR a.teacher_id = s.user_id
  ) y;

  SELECT to_jsonb(z) INTO v_settings
  FROM (SELECT * FROM public.settings LIMIT 1) z;

  RETURN jsonb_build_object(
    'teachers',   v_teachers,
    'attendance', v_attendance,
    'settings',   COALESCE(v_settings, '{}'::jsonb)
  );
END;
$$;


-- ------------------------------------------------------------
-- 2. app_get_signatures — tanda tangan sesuai permintaan
-- ------------------------------------------------------------
-- Mengembalikan peta { id presensi -> data URL tanda tangan }.
-- Baris tanpa tanda tangan tetap dikembalikan sebagai string kosong, supaya
-- aplikasi tahu baris itu sudah diperiksa dan tidak memintanya berulang kali.

CREATE OR REPLACE FUNCTION public.app_get_signatures(p_token UUID, p_ids TEXT[])
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.app_sessions;
        v JSONB;
BEGIN
  s := public._app_require(p_token);

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Aturan peran sama persis dengan app_bootstrap.
  SELECT COALESCE(jsonb_object_agg(a.id, COALESCE(a.signature, '')), '{}'::jsonb) INTO v
  FROM public.attendance a
  WHERE a.id = ANY(p_ids)
    AND (s.role = 'admin' OR a.teacher_id = s.user_id);

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_signatures(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_signatures(UUID, TEXT[]) TO anon;


-- ============================================================
--  PEMERIKSAAN SESUDAH DIJALANKAN
-- ============================================================
--  Jumlah baris harus tetap 161 dan tanda tangan tetap 155.
--  Kalau angkanya berubah, ada yang salah — hentikan dan periksa.
--
--   SELECT count(*) AS baris,
--          count(*) FILTER (WHERE signature IS NOT NULL AND signature <> '') AS bertanda_tangan,
--          pg_size_pretty(pg_total_relation_size('public.attendance')) AS ukuran
--   FROM public.attendance;
-- ============================================================

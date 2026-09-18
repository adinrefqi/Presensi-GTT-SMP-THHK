-- ============================================================
-- MIGRATION RLS LOCKDOWN: Presensi GTT SMP THHK
-- Menutup akses langsung anon ke tabel. Semua baca/tulis
-- lewat RPC SECURITY DEFINER yang memeriksa token sesi.
--
-- URUTAN PEMASANGAN (PENTING, jangan dibalik):
--   1. Jalankan BAGIAN 1-6 file ini di Supabase SQL Editor.
--   2. Deploy app.js + index.html versi baru.
--   3. Pastikan login admin & guru berhasil.
--   4. Baru jalankan BAGIAN 7 (pencabutan akses anon).
-- Jika BAGIAN 7 dijalankan sebelum app.js baru ter-deploy,
-- aplikasi lama akan langsung berhenti bekerja.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- BAGIAN 1: TABEL SESI
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_sessions (
  token      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'guru')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '12 hours'
);

CREATE INDEX IF NOT EXISTS app_sessions_expires_idx ON public.app_sessions (expires_at);

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
-- Tanpa policy = anon tidak bisa menyentuh tabel ini sama sekali.
-- Hanya fungsi SECURITY DEFINER di bawah yang boleh membacanya.

-- Ambil sesi yang masih berlaku. NULL jika token salah / kedaluwarsa.
CREATE OR REPLACE FUNCTION public._app_session(p_token UUID)
RETURNS public.app_sessions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.app_sessions WHERE token = p_token AND expires_at > now();
$$;

-- Sesi yang valid, atau error kalau tidak.
CREATE OR REPLACE FUNCTION public._app_require(p_token UUID, p_role TEXT DEFAULT NULL)
RETURNS public.app_sessions
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.app_sessions;
BEGIN
  s := public._app_session(p_token);
  IF s.token IS NULL THEN
    RAISE EXCEPTION 'SESSION_INVALID' USING HINT = 'Sesi tidak valid atau sudah berakhir. Silakan login ulang.';
  END IF;
  IF p_role IS NOT NULL AND s.role <> p_role THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = format('Aksi ini hanya untuk %s.', p_role);
  END IF;
  RETURN s;
END;
$$;

-- ============================================================
-- BAGIAN 2: LOGIN — sekarang menerbitkan token sesi
-- ============================================================

DROP FUNCTION IF EXISTS public.verify_admin_login(text, text);
DROP FUNCTION IF EXISTS public.verify_teacher_login(text);
DROP FUNCTION IF EXISTS public.verify_teacher_login(text, text);

CREATE OR REPLACE FUNCTION public.verify_admin_login(input_username TEXT, input_password TEXT)
RETURNS TABLE(username VARCHAR, name VARCHAR, token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.admins;
        t UUID;
BEGIN
  DELETE FROM public.app_sessions WHERE expires_at < now();

  SELECT * INTO a FROM public.admins adm
   WHERE adm.username = lower(trim(input_username))
     AND adm.password = crypt(input_password, adm.password);

  IF a.username IS NULL THEN RETURN; END IF;

  INSERT INTO public.app_sessions (user_id, role) VALUES (a.username, 'admin')
  RETURNING app_sessions.token INTO t;

  RETURN QUERY SELECT a.username, a.name, t;
END;
$$;

-- Login guru: input tetap sama persis (nama depan + password),
-- hanya pencocokan namanya dipindah dari browser ke server supaya
-- token sesi diterbitkan untuk guru yang benar.
CREATE OR REPLACE FUNCTION public.verify_teacher_login(input_username TEXT, input_password TEXT)
RETURNS TABLE(id VARCHAR, name VARCHAR, subject VARCHAR, rate NUMERIC, transport NUMERIC, status VARCHAR, token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tc public.teachers;
        u  TEXT := lower(trim(input_username));
        w  TEXT[];
        w1 TEXT;
        w2 TEXT;
        tok UUID;
BEGIN
  DELETE FROM public.app_sessions WHERE expires_at < now();

  FOR tc IN
    SELECT * FROM public.teachers t
     WHERE t.status = 'aktif'
       AND t.password = crypt(input_password, t.password)
  LOOP
    w  := regexp_split_to_array(trim(tc.name), '\s+');
    w1 := lower(regexp_replace(COALESCE(w[1], ''), '[^a-zA-Z]', '', 'g'));
    w2 := lower(regexp_replace(COALESCE(w[2], ''), '[^a-zA-Z]', '', 'g'));

    IF (w1 = 'ws' AND (u = 'ws' OR u = w2)) OR (w1 <> 'ws' AND u = w1) THEN
      INSERT INTO public.app_sessions (user_id, role) VALUES (tc.id, 'guru')
      RETURNING app_sessions.token INTO tok;

      RETURN QUERY SELECT tc.id, tc.name, tc.subject, tc.rate, tc.transport, tc.status, tok;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_logout(p_token UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.app_sessions WHERE token = p_token;
$$;

-- ============================================================
-- BAGIAN 3: BACA DATA — satu panggilan, difilter per peran
-- ============================================================

CREATE OR REPLACE FUNCTION public.app_bootstrap(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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

  SELECT COALESCE(jsonb_agg(to_jsonb(y)), '[]'::jsonb) INTO v_attendance
  FROM (
    SELECT a.id, a.teacher_id, a.date, a.status, a.jp, a.class, a.topic, a.signature
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

-- ============================================================
-- BAGIAN 4: TULIS PRESENSI
-- ============================================================

CREATE OR REPLACE FUNCTION public.app_save_attendance(
  p_token      UUID,
  p_id         TEXT,
  p_teacher_id TEXT,
  p_date       DATE,
  p_status     TEXT,
  p_jp         INT,
  p_class      TEXT,
  p_topic      TEXT,
  p_signature  TEXT DEFAULT NULL,
  p_is_update  BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.app_sessions;
        owner_id TEXT;
BEGIN
  s := public._app_require(p_token);

  -- Guru hanya boleh menulis presensi dirinya sendiri.
  IF s.role = 'guru' AND p_teacher_id IS DISTINCT FROM s.user_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'Guru hanya dapat mengisi presensi sendiri.';
  END IF;

  IF p_is_update THEN
    SELECT a.teacher_id INTO owner_id FROM public.attendance a WHERE a.id = p_id;
    IF owner_id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND' USING HINT = 'Catatan presensi tidak ditemukan.';
    END IF;
    IF s.role = 'guru' AND owner_id <> s.user_id THEN
      RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'Guru hanya dapat mengubah presensi sendiri.';
    END IF;

    UPDATE public.attendance SET
      teacher_id = p_teacher_id,
      date       = p_date,
      status     = p_status,
      jp         = p_jp,
      class      = p_class,
      topic      = p_topic,
      signature  = COALESCE(NULLIF(p_signature, ''), signature)
    WHERE id = p_id;
  ELSE
    INSERT INTO public.attendance (id, teacher_id, date, status, jp, class, topic, signature)
    VALUES (p_id, p_teacher_id, p_date, p_status, p_jp, p_class, p_topic, NULLIF(p_signature, ''));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_delete_attendance(p_token UUID, p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.app_sessions;
        owner_id TEXT;
BEGIN
  s := public._app_require(p_token);

  SELECT a.teacher_id INTO owner_id FROM public.attendance a WHERE a.id = p_id;
  IF owner_id IS NULL THEN RETURN; END IF;

  IF s.role = 'guru' AND owner_id <> s.user_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'Guru hanya dapat menghapus presensi sendiri.';
  END IF;

  DELETE FROM public.attendance WHERE id = p_id;
END;
$$;

-- Dipakai tombol "Muat Data Demo" (admin saja).
CREATE OR REPLACE FUNCTION public.app_bulk_insert_attendance(p_token UUID, p_rows JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._app_require(p_token, 'admin');

  INSERT INTO public.attendance (id, teacher_id, date, status, jp, class, topic)
  SELECT r->>'id', r->>'teacher_id', (r->>'date')::date, r->>'status',
         COALESCE((r->>'jp')::int, 0), r->>'class', r->>'topic'
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$;

-- ============================================================
-- BAGIAN 5: TULIS GURU & PENGATURAN (admin saja)
-- ============================================================

CREATE OR REPLACE FUNCTION public.app_save_teacher(
  p_token     UUID,
  p_id        VARCHAR,
  p_name      VARCHAR,
  p_subject   VARCHAR,
  p_rate      NUMERIC,
  p_transport NUMERIC,
  p_status    VARCHAR,
  p_password  VARCHAR DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._app_require(p_token, 'admin');
  PERFORM public.upsert_teacher_with_hash(p_id, p_name, p_subject, p_rate, p_transport, p_status, p_password);
END;
$$;

CREATE OR REPLACE FUNCTION public.app_delete_teacher(p_token UUID, p_id VARCHAR)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._app_require(p_token, 'admin');
  DELETE FROM public.teachers WHERE id = p_id;  -- attendance ikut terhapus (ON DELETE CASCADE)
END;
$$;

CREATE OR REPLACE FUNCTION public.app_save_settings(
  p_token          UUID,
  p_school_name    VARCHAR,
  p_school_address TEXT,
  p_principal_name VARCHAR,
  p_principal_nip  VARCHAR,
  p_treasurer_name VARCHAR,
  p_treasurer_nip  VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._app_require(p_token, 'admin');

  INSERT INTO public.settings (id, school_name, school_address, principal_name, principal_nip, treasurer_name, treasurer_nip)
  VALUES (1, p_school_name, p_school_address, p_principal_name, p_principal_nip, p_treasurer_name, p_treasurer_nip)
  ON CONFLICT (id) DO UPDATE SET
    school_name    = EXCLUDED.school_name,
    school_address = EXCLUDED.school_address,
    principal_name = EXCLUDED.principal_name,
    principal_nip  = EXCLUDED.principal_nip,
    treasurer_name = EXCLUDED.treasurer_name,
    treasurer_nip  = EXCLUDED.treasurer_nip;
END;
$$;

-- p_wipe_teachers = false dipakai saat memuat data demo (guru ditulis ulang setelahnya).
CREATE OR REPLACE FUNCTION public.app_reset_data(p_token UUID, p_reset_settings BOOLEAN DEFAULT true)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._app_require(p_token, 'admin');

  DELETE FROM public.attendance;
  DELETE FROM public.teachers;

  IF p_reset_settings THEN
    UPDATE public.settings SET
      school_name    = 'SMP THHK Tegal',
      school_address = 'Jl. Dr. Sutomo No.50, Kota Tegal',
      principal_name = 'Haryanto, S.Pd., M.M.',
      principal_nip  = '19740512 199903 1 002',
      treasurer_name = 'Siti Rahmawati, A.Md.',
      treasurer_nip  = '-'
    WHERE id = 1;
  END IF;
END;
$$;

-- ============================================================
-- BAGIAN 6: HAK EKSEKUSI FUNGSI
-- Hanya fungsi di bawah ini yang boleh dipanggil anon.
-- ============================================================

REVOKE ALL ON FUNCTION public._app_session(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._app_require(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_teacher_with_hash(VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_admin_password(VARCHAR, VARCHAR) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.verify_admin_login(TEXT, TEXT)          TO anon;
GRANT EXECUTE ON FUNCTION public.verify_teacher_login(TEXT, TEXT)        TO anon;
GRANT EXECUTE ON FUNCTION public.app_logout(UUID)                        TO anon;
GRANT EXECUTE ON FUNCTION public.app_bootstrap(UUID)                     TO anon;
GRANT EXECUTE ON FUNCTION public.app_save_attendance(UUID, TEXT, TEXT, DATE, TEXT, INT, TEXT, TEXT, TEXT, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION public.app_delete_attendance(UUID, TEXT)       TO anon;
GRANT EXECUTE ON FUNCTION public.app_bulk_insert_attendance(UUID, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.app_save_teacher(UUID, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR) TO anon;
GRANT EXECUTE ON FUNCTION public.app_delete_teacher(UUID, VARCHAR)       TO anon;
GRANT EXECUTE ON FUNCTION public.app_save_settings(UUID, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO anon;
GRANT EXECUTE ON FUNCTION public.app_reset_data(UUID, BOOLEAN)           TO anon;

-- ============================================================
-- BAGIAN 7: CABUT AKSES LANGSUNG ANON KE TABEL
-- >>> JALANKAN SETELAH app.js BARU TER-DEPLOY DAN LOGIN TERUJI <<<
-- ============================================================

-- DROP POLICY IF EXISTS "teachers_select"    ON public.teachers;
-- DROP POLICY IF EXISTS "teachers_insert"    ON public.teachers;
-- DROP POLICY IF EXISTS "teachers_update"    ON public.teachers;
-- DROP POLICY IF EXISTS "teachers_delete"    ON public.teachers;
-- DROP POLICY IF EXISTS "attendance_select"  ON public.attendance;
-- DROP POLICY IF EXISTS "attendance_insert"  ON public.attendance;
-- DROP POLICY IF EXISTS "attendance_update"  ON public.attendance;
-- DROP POLICY IF EXISTS "attendance_delete"  ON public.attendance;
-- DROP POLICY IF EXISTS "settings_select"    ON public.settings;
-- DROP POLICY IF EXISTS "settings_update"    ON public.settings;
-- DROP POLICY IF EXISTS "settings_insert"    ON public.settings;
--
-- REVOKE ALL ON public.teachers      FROM anon;
-- REVOKE ALL ON public.attendance    FROM anon;
-- REVOKE ALL ON public.settings      FROM anon;
-- REVOKE ALL ON public.admins        FROM anon;
-- REVOKE ALL ON public.teachers_safe FROM anon;
-- REVOKE ALL ON public.app_sessions  FROM anon;
--
-- ALTER TABLE public.teachers   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.settings   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.admins     ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- VERIFIKASI
-- ============================================================
-- Setelah BAGIAN 7, query ini HARUS gagal / kosong bagi anon:
--   SELECT * FROM public.teachers;
-- dan ini harus tetap bekerja:
--   SELECT * FROM verify_admin_login('admin', '<password>');
--   SELECT app_bootstrap('<token dari login>');

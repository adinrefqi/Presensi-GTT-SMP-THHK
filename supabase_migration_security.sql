-- ============================================================
-- MIGRATION KEAMANAN: Presensi GTT SMP THHK
-- Jalankan file ini di Supabase SQL Editor SETELAH setup awal
-- ============================================================

-- ============================================================
-- BAGIAN 0: PERBAIKAN STUKTUR TABEL SETTINGS
-- ============================================================
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS id INT DEFAULT 1;
UPDATE public.settings SET id = 1 WHERE id IS NULL;

-- ============================================================
-- BAGIAN 1: AKTIFKAN EXTENSION PGCRYPTO
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- BAGIAN 2: HASH SEMUA PASSWORD YANG SUDAH ADA (MIGRASI DATA)
-- ============================================================

-- Update / Set password admin ('admin' & 'elsa') ke 'admin1122' dengan hash bcrypt
INSERT INTO public.admins (username, password, name) VALUES
('admin', crypt('admin1122', gen_salt('bf', 8)), 'Admin THHK'),
('elsa', crypt('admin1122', gen_salt('bf', 8)), 'Elsa Angreani, S.T')
ON CONFLICT (username) DO UPDATE SET password = crypt('admin1122', gen_salt('bf', 8));

-- Pastikan data guru default selalu ada (dengan password terenkripsi)
INSERT INTO public.teachers (id, name, subject, rate, transport, status, password) VALUES
('199003122022031001', 'Anom Kudho Winanto, S.Sn.', 'Seni Budaya', 50000, 20000, 'aktif', crypt('anom312', gen_salt('bf', 8))),
('199208152021022002', 'Brigita Ajeng Dwiandari, S.Pd', 'Matematika', 50000, 20000, 'aktif', crypt('brigita815', gen_salt('bf', 8))),
('199411202022032003', 'Fransiska Virgiana M, S.Pd', 'Bahasa Indonesia', 50000, 20000, 'aktif', crypt('fransiska112', gen_salt('bf', 8))),
('198505102018031004', 'Ismadi, S.Pd', 'Fisika', 55000, 25000, 'aktif', crypt('ismadi510', gen_salt('bf', 8))),
('198810052019052005', 'WS. Inggried Budiarti, S.Pd', 'Informatika', 50000, 20000, 'aktif', crypt('inggried005', gen_salt('bf', 8))),
('199606142023022006', 'Yunita Mentari Putri, S. Sn', 'Seni Budaya', 45000, 20000, 'aktif', crypt('yunita614', gen_salt('bf', 8))),
('198712252016031007', 'Atmo Kusumo, S.Pd.', 'Penjasorkes', 45000, 20000, 'aktif', crypt('atmo225', gen_salt('bf', 8)))
ON CONFLICT (id) DO NOTHING;

-- Hash password guru lain yang mungkin masih plain text
UPDATE public.teachers
SET password = crypt(password, gen_salt('bf', 8))
WHERE password NOT LIKE '$2a$%' AND password NOT LIKE '$2b$%';

-- ============================================================
-- BAGIAN 3: FUNGSI RPC UNTUK VERIFIKASI LOGIN (SERVER-SIDE)
-- Password tidak pernah dikirim kembali ke client
-- ============================================================

-- HAPUS FUNGSI LAMA AGAR TIDAK TERJADI DUPLIKASI ATAU AMBIGUITAS PARAMETER DI POSTGREST
DROP FUNCTION IF EXISTS public.verify_admin_login(text, text);
DROP FUNCTION IF EXISTS public.verify_admin_login(varchar, varchar);
DROP FUNCTION IF EXISTS public.verify_admin_login CASCADE;

DROP FUNCTION IF EXISTS public.verify_teacher_login(text);
DROP FUNCTION IF EXISTS public.verify_teacher_login(varchar);
DROP FUNCTION IF EXISTS public.verify_teacher_login CASCADE;

DROP FUNCTION IF EXISTS public.upsert_teacher_with_hash CASCADE;
DROP FUNCTION IF EXISTS public.update_admin_password CASCADE;

-- Fungsi login admin: mengembalikan data admin jika cocok
CREATE OR REPLACE FUNCTION verify_admin_login(input_username TEXT, input_password TEXT)
RETURNS TABLE(username VARCHAR, name VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT a.username, a.name
  FROM public.admins a
  WHERE a.username = input_username
    AND a.password = crypt(input_password, a.password);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fungsi login guru: mengembalikan data guru jika password cocok
-- Mengembalikan SEMUA guru aktif yang cocok passwordnya,
-- client akan mencocokkan berdasarkan nama depan (username)
CREATE OR REPLACE FUNCTION verify_teacher_login(input_password TEXT)
RETURNS TABLE(
  id VARCHAR,
  name VARCHAR,
  subject VARCHAR,
  rate NUMERIC,
  transport NUMERIC,
  status VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.name, t.subject, t.rate, t.transport, t.status
  FROM public.teachers t
  WHERE t.status = 'aktif'
    AND t.password = crypt(input_password, t.password);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fungsi untuk menyimpan guru baru DENGAN hashing password
CREATE OR REPLACE FUNCTION upsert_teacher_with_hash(
  p_id VARCHAR,
  p_name VARCHAR,
  p_subject VARCHAR,
  p_rate NUMERIC,
  p_transport NUMERIC,
  p_status VARCHAR,
  p_password VARCHAR
)
RETURNS VOID AS $$
BEGIN
  -- Cek apakah guru sudah ada
  IF EXISTS (SELECT 1 FROM public.teachers WHERE teachers.id = p_id) THEN
    -- Update existing teacher
    UPDATE public.teachers SET
      name = p_name,
      subject = p_subject,
      rate = p_rate,
      transport = p_transport,
      status = p_status,
      password = crypt(p_password, gen_salt('bf', 8))
    WHERE teachers.id = p_id;
  ELSE
    -- Insert new teacher
    INSERT INTO public.teachers (id, name, subject, rate, transport, status, password)
    VALUES (p_id, p_name, p_subject, p_rate, p_transport, p_status, crypt(p_password, gen_salt('bf', 8)));
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fungsi untuk mengubah password admin dengan hashing
CREATE OR REPLACE FUNCTION update_admin_password(p_username VARCHAR, p_new_password VARCHAR)
RETURNS VOID AS $$
BEGIN
  UPDATE public.admins
  SET password = crypt(p_new_password, gen_salt('bf', 8))
  WHERE admins.username = p_username;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- BAGIAN 4: AKTIFKAN ROW LEVEL SECURITY (RLS) PADA SEMUA TABEL
-- ============================================================

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BAGIAN 5: BUAT POLICY UNTUK SETIAP TABEL
-- ============================================================

-- ---- TABEL ADMINS ----
-- Direct access ditolak. Login hanya via RPC (SECURITY DEFINER bypass RLS)

DROP POLICY IF EXISTS "admins_anon_no_direct_access" ON public.admins;
CREATE POLICY "admins_anon_no_direct_access" ON public.admins
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);


-- ---- TABEL TEACHERS ----
-- SELECT, INSERT, UPDATE, DELETE diizinkan untuk anon
-- Password hashing ditangani oleh RPC upsert_teacher_with_hash

DROP POLICY IF EXISTS "teachers_select" ON public.teachers;
CREATE POLICY "teachers_select" ON public.teachers
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "teachers_insert" ON public.teachers;
CREATE POLICY "teachers_insert" ON public.teachers
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "teachers_update" ON public.teachers;
CREATE POLICY "teachers_update" ON public.teachers
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "teachers_delete" ON public.teachers;
CREATE POLICY "teachers_delete" ON public.teachers
  FOR DELETE
  TO anon
  USING (true);


-- ---- TABEL ATTENDANCE ----
-- Full CRUD untuk anon

DROP POLICY IF EXISTS "attendance_select" ON public.attendance;
CREATE POLICY "attendance_select" ON public.attendance
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "attendance_insert" ON public.attendance;
CREATE POLICY "attendance_insert" ON public.attendance
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "attendance_update" ON public.attendance;
CREATE POLICY "attendance_update" ON public.attendance
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "attendance_delete" ON public.attendance;
CREATE POLICY "attendance_delete" ON public.attendance
  FOR DELETE
  TO anon
  USING (true);


-- ---- TABEL SETTINGS ----
-- SELECT, UPDATE, INSERT diizinkan

DROP POLICY IF EXISTS "settings_select" ON public.settings;
CREATE POLICY "settings_select" ON public.settings
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "settings_update" ON public.settings;
CREATE POLICY "settings_update" ON public.settings
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "settings_insert" ON public.settings;
CREATE POLICY "settings_insert" ON public.settings
  FOR INSERT
  TO anon
  WITH CHECK (true);


-- ============================================================
-- BAGIAN 6: BUAT VIEW UNTUK TEACHERS TANPA KOLOM PASSWORD
-- Agar client SELECT dari view ini (bukan langsung tabel)
-- ============================================================

CREATE OR REPLACE VIEW public.teachers_safe AS
SELECT id, name, subject, rate, transport, status, created_at
FROM public.teachers;

-- Grant akses ke view untuk anon
GRANT SELECT ON public.teachers_safe TO anon;


-- ============================================================
-- VERIFIKASI: Jalankan query ini untuk memastikan semuanya OK
-- ============================================================

-- Test 1: Cek RLS aktif
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Test 2: Cek policy
-- SELECT * FROM pg_policies WHERE schemaname = 'public';

-- Test 3: Cek fungsi RPC
-- SELECT * FROM verify_admin_login('admin', 'admin123');

-- Test 4: Cek view aman (tidak ada kolom password)
-- SELECT * FROM public.teachers_safe LIMIT 1;

-- Setup Database Presensi GTT SMP THHK di Supabase (PostgreSQL)

-- 1. Tabel Administrator
CREATE TABLE IF NOT EXISTS public.admins (
    username VARCHAR(50) PRIMARY KEY,
    password VARCHAR(100) NOT NULL DEFAULT 'admin123',
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabel Guru GTT
CREATE TABLE IF NOT EXISTS public.teachers (
    id VARCHAR(50) PRIMARY KEY, -- NUPTK / NIP / ID Guru
    name VARCHAR(100) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    rate NUMERIC(12, 2) NOT NULL DEFAULT 50000.00,
    transport NUMERIC(12, 2) NOT NULL DEFAULT 20000.00,
    status VARCHAR(20) NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif')),
    password VARCHAR(100) NOT NULL DEFAULT 'guru123',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Migrasi untuk menambahkan kolom password pada tabel teachers jika belum ada
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS password VARCHAR(100) NOT NULL DEFAULT 'guru123';

-- 3. Tabel Presensi & KBM
CREATE TABLE IF NOT EXISTS public.attendance (
    id VARCHAR(100) PRIMARY KEY,
    teacher_id VARCHAR(50) NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('Hadir', 'Sakit', 'Izin', 'Alpa')),
    jp INT NOT NULL DEFAULT 0,
    class VARCHAR(100),
    topic TEXT,
    signature TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_teacher_date UNIQUE (teacher_id, date)
);

-- Migrasi untuk menambahkan kolom signature pada tabel attendance jika belum ada
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS signature TEXT;

-- 4. Tabel Pengaturan Sekolah
CREATE TABLE IF NOT EXISTS public.settings (
    id INT PRIMARY KEY DEFAULT 1 CONSTRAINT only_one_row CHECK (id = 1),
    school_name VARCHAR(150) NOT NULL DEFAULT 'SMP THHK Tegal',
    school_address TEXT DEFAULT 'Jl. Dr. Sutomo No.50, Kota Tegal',
    principal_name VARCHAR(100) NOT NULL DEFAULT 'Haryanto, S.Pd., M.M.',
    principal_nip VARCHAR(50) DEFAULT '19740512 199903 1 002',
    treasurer_name VARCHAR(100) NOT NULL DEFAULT 'Siti Rahmawati, A.Md.',
    treasurer_nip VARCHAR(50) DEFAULT '-',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Migrasi untuk menambahkan kolom id jika tabel settings sudah ada sebelumnya tanpa kolom id
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS id INT DEFAULT 1;
UPDATE public.settings SET id = 1 WHERE id IS NULL;

-- Trigger untuk memperbarui kolom updated_at pada tabel settings
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON public.settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ==========================================
-- INSERT DATA DEMO / AWAL (SEED DATA)
-- ==========================================

-- Data Admin Awal
INSERT INTO public.admins (username, password, name) VALUES 
('admin', 'admin123', 'Admin THHK'),
('elsa', 'admin123', 'Elsa Angreani, S.T')
ON CONFLICT (username) DO NOTHING;

-- Data Guru GTT Awal (Dengan Password Unik Setiap Guru)
INSERT INTO public.teachers (id, name, subject, rate, transport, status, password) VALUES
('199003122022031001', 'Anom Kudho Winanto, S.Sn.', 'Seni Budaya', 50000, 20000, 'aktif', 'anom312'),
('199208152021022002', 'Brigita Ajeng Dwiandari, S.Pd', 'Matematika', 50000, 20000, 'aktif', 'brigita815'),
('199411202022032003', 'Fransiska Virgiana M, S.Pd', 'Bahasa Indonesia', 50000, 20000, 'aktif', 'fransiska112'),
('198505102018031004', 'Ismadi, S.Pd', 'Fisika', 55000, 25000, 'aktif', 'ismadi510'),
('198810052019052005', 'WS. Inggried Budiarti, S.Pd', 'Informatika', 50000, 20000, 'aktif', 'inggried005'),
('199606142023022006', 'Yunita Mentari Putri, S. Sn', 'Seni Budaya', 45000, 20000, 'aktif', 'yunita614'),
('198712252016031007', 'Atmo Kusumo, S.Pd.', 'Penjasorkes', 45000, 20000, 'aktif', 'atmo225')
ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password;

-- Data Pengaturan Default
INSERT INTO public.settings (id, school_name, school_address, principal_name, principal_nip, treasurer_name, treasurer_nip)
VALUES (1, 'SMP THHK Tegal', 'Jl. Dr. Sutomo No.50, Kota Tegal', 'Haryanto, S.Pd., M.M.', '19740512 199903 1 002', 'Siti Rahmawati, A.Md.', '-')
ON CONFLICT (id) DO NOTHING;

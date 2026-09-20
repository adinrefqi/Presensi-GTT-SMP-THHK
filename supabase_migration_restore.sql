-- ============================================================
--  Restore cadangan yang benar-benar sampai ke server
--  Dijalankan: 20 September 2026  — temuan #13
-- ============================================================
--
--  MASALAH
--  importRestoreJSON() di app.js hanya mengisi state dan localStorage, lalu
--  menampilkan "Restorasi database berhasil dilakukan!". Begitu halaman dimuat
--  ulang, app_bootstrap menimpanya. Artinya cadangan pemilik selama ini tidak
--  punya jalur pemulihan sama sekali.
--
--  app_bulk_insert_attendance yang sudah ada tidak bisa dipakai untuk ini:
--  ia tidak mengirim kolom signature, dan INSERT-nya tanpa ON CONFLICT
--  sehingga langsung gagal begitu bertemu ID yang sudah ada.
--
--  ATURAN KESELAMATAN YANG DIPEGANG FUNGSI INI
--  1. TIDAK PERNAH MENGHAPUS. Hanya menambah dan memperbarui. Memulihkan
--     cadangan lama tidak akan pernah menghilangkan data yang lebih baru.
--     Kesalahan terburuk yang mungkin terjadi hanyalah baris lama muncul
--     kembali — bukan kehilangan.
--  2. Tanda tangan lama tidak dihapus kalau cadangan tidak membawanya.
--     Cadangan lama memang ada yang tidak menyertakan signature.
--  3. Baris yang bentrok dengan presensi lain di guru+tanggal yang sama tapi
--     ber-ID berbeda akan DILEWATI, bukan ditimpa — menimpanya bisa menghapus
--     catatan sah yang kebetulan menempati slot itu (ada CONSTRAINT
--     unique_teacher_date). Jumlah yang dilewati dilaporkan balik supaya tidak
--     ada yang hilang diam-diam.
--  4. Satu pernyataan saja: kalau gagal, tidak ada yang tertulis sama sekali.
--
--  CATATAN TEKNIS
--  Sengaja memakai CTE, bukan tabel temporer. Fungsi ini SECURITY DEFINER
--  dengan search_path = public, extensions; pg_temp tidak ada di search_path
--  sehingga tabel temporer tak akan terbaca, dan menambahkan pg_temp ke
--  search_path fungsi SECURITY DEFINER itu sendiri berisiko keamanan.
--
--  Aman dijalankan ulang (CREATE OR REPLACE).
-- ============================================================


CREATE OR REPLACE FUNCTION public.app_restore_attendance(p_token UUID, p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_hasil JSONB;
BEGIN
  PERFORM public._app_require(p_token, 'admin');

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('total', 0, 'ditambah', 0, 'diperbarui', 0, 'dilewati', 0);
  END IF;

  WITH src AS (
    SELECT r->>'id'                     AS id,
           r->>'teacher_id'             AS teacher_id,
           (r->>'date')::date           AS tgl,
           r->>'status'                 AS status,
           COALESCE((r->>'jp')::int, 0) AS jp,
           r->>'class'                  AS kelas,
           r->>'topic'                  AS topik,
           NULLIF(r->>'signature', '')  AS signature
    FROM jsonb_array_elements(p_rows) AS r
    WHERE r->>'id' IS NOT NULL
      AND r->>'teacher_id' IS NOT NULL
      AND r->>'date' IS NOT NULL
  ),
  -- Aturan 3: buang yang menabrak slot guru+tanggal milik baris lain.
  sah AS (
    SELECT s.* FROM src s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.teacher_id = s.teacher_id
        AND a.date       = s.tgl
        AND a.id        <> s.id
    )
  ),
  -- Dihitung dari snapshot sebelum INSERT, jadi angkanya benar.
  klasifikasi AS (
    SELECT (a.id IS NULL) AS baru
    FROM sah s LEFT JOIN public.attendance a ON a.id = s.id
  ),
  -- CTE yang mengubah data selalu dijalankan sampai tuntas, walau tidak dibaca.
  ins AS (
    INSERT INTO public.attendance (id, teacher_id, date, status, jp, class, topic, signature)
    SELECT s.id, s.teacher_id, s.tgl, s.status, s.jp, s.kelas, s.topik, s.signature
    FROM sah s
    ON CONFLICT (id) DO UPDATE SET
      teacher_id = EXCLUDED.teacher_id,
      date       = EXCLUDED.date,
      status     = EXCLUDED.status,
      jp         = EXCLUDED.jp,
      class      = EXCLUDED.class,
      topic      = EXCLUDED.topic,
      -- Aturan 2: jangan hapus tanda tangan yang sudah ada.
      signature  = COALESCE(EXCLUDED.signature, public.attendance.signature)
    RETURNING 1
  )
  SELECT jsonb_build_object(
    'total',      (SELECT count(*) FROM src),
    'ditambah',   (SELECT count(*) FILTER (WHERE baru)     FROM klasifikasi),
    'diperbarui', (SELECT count(*) FILTER (WHERE NOT baru) FROM klasifikasi),
    'dilewati',   (SELECT count(*) FROM src) - (SELECT count(*) FROM sah)
  ) INTO v_hasil;

  RETURN v_hasil;
END;
$$;

REVOKE ALL ON FUNCTION public.app_restore_attendance(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_restore_attendance(UUID, JSONB) TO anon;


-- ============================================================
--  PEMERIKSAAN SESUDAH DIJALANKAN
-- ============================================================
--  Migrasi ini hanya mendefinisikan fungsi; belum mengubah data apa pun
--  sampai dipanggil dari aplikasi. Angkanya harus masih sama:
--
--   SELECT count(*) AS baris,
--          count(*) FILTER (WHERE signature IS NOT NULL AND signature <> '') AS bertanda_tangan
--   FROM public.attendance;
-- ============================================================

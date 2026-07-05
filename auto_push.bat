@echo off
:: Mengubah direktori kerja ke folder di mana file bat ini berada
cd /d "%~dp0"

echo ===================================================
echo   AUTO PUSH GIT - PRESENSI GTT SMP THHK
echo ===================================================
echo.

:: Cek status repositori
echo [1/4] Memeriksa status berkas...
git status -s
echo.

:: Menambahkan semua perubahan ke staging
echo [2/4] Menyiapkan berkas (git add)...
git add .
echo.

:: Meminta masukan pesan commit dari pengguna
set /p msg="Masukkan pesan commit (tekan Enter untuk menggunakan waktu saat ini): "

:: Jika pesan kosong, gunakan waktu sistem sebagai default
if "%msg%"=="" (
    set msg="Pembaruan berkas otomatis pada %date% %time%"
)

:: Melakukan commit
echo.
echo [3/4] Melakukan commit dengan pesan: %msg%
git commit -m "%msg%"
echo.

:: Melakukan push ke GitHub
echo [4/4] Mengunggah perubahan ke GitHub...
git push origin main
echo.

echo ===================================================
echo   Selesai! Tekan tombol apa saja untuk keluar.
echo ===================================================
pause > nul

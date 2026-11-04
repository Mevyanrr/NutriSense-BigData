@echo off
cd /d %~dp0
python 01_etl.py || goto err
python 02_analytics.py || goto err
python 03_kmeans.py || goto err
echo SEMUA SELESAI
goto end
:err
echo GAGAL, lihat pesan error di atas
:end
pause
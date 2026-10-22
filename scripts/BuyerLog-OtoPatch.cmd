@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
:MENU
cls
echo ==========================================================
echo    BUYER LOG - OTOMATIK MINI PATCH (7.0.293)
echo ==========================================================
echo.
echo  [G] En yeni patch'i indir ve uygula
echo  [K] Yeni patch kontrolu (dosyalari degistirme)
echo  [R] Son mini patch'i geri al (internetsiz)
echo  [D] Yerel durum / yedekler
echo  [C] Cikis
echo.
set /p "CHOICE=Seciminiz: "
if /I "%CHOICE%"=="C" exit /b 0
set "MODE="
if /I "%CHOICE%"=="G" set "MODE=Update"
if /I "%CHOICE%"=="K" set "MODE=Check"
if /I "%CHOICE%"=="R" set "MODE=Rollback"
if /I "%CHOICE%"=="D" set "MODE=Status"
if not defined MODE goto MENU
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0BuyerLog-OtoPatch.ps1" -Action %MODE%
if errorlevel 1 echo.
if errorlevel 1 echo Islem tamamlanamadi. Hata aciklamasini kontrol edin.
echo.
pause
goto MENU

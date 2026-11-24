@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Buyer Log - Merch Kod Eslemesi

rem ============================================================
rem Excel/CSV dosyasini bu dosyanin uzerine surukleyip birakin.
rem MAG / MMYG basliklarini ve kodlarini eslestirir; sonucu
rem kaynak dosyanin yanina "<ad>-merch-esleme.xlsx" olarak yazar.
rem Kaynak dosya degistirilmez. Dosya verilmezse baslik sozlugu.
rem Ek secenek: --find KOD  (or. ... dosya.xlsx --find CU4E)
rem ============================================================

set "HERE=%~dp0"
set "SCRIPT=%HERE%merch-code-map.js"
set "EXE=%HERE%..\..\..\BuyerLog.exe"

if "%~1"=="" (
  call :run
) else (
  call :run "%~1" --out "%~dpn1-merch-esleme.xlsx" %2 %3 %4 %5
)
echo.
pause
exit /b %ERRORLEVEL%

:run
where node >nul 2>nul
if not errorlevel 1 (
  node "%SCRIPT%" %*
  exit /b %ERRORLEVEL%
)
if exist "%EXE%" (
  set "ELECTRON_RUN_AS_NODE=1"
  "%EXE%" "%SCRIPT%" %*
  exit /b %ERRORLEVEL%
)
echo Node.js veya BuyerLog.exe bulunamadi. / Node.js or BuyerLog.exe not found.
exit /b 2

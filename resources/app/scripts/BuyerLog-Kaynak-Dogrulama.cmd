@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Buyer Log - Kaynak Dogrulama (ASAS / IAS / Excel)

rem ------------------------------------------------------------------
rem  Buyer Log'un ASAS ve IAS veri cekme + eslestirme motorlarini
rem  BL'in kendi modulleri ve kendi ayarlariyla calistirir:
rem    1) Excel raporlari (pivot yenilenmis KOPYA)  -> dogruluk referansi
rem    2) Database - BL'in bugunku sorgusu
rem    3) Database - IAS aday sorgusu (RELATED)
rem  ve sonuclari birebir karsilastirir. Kumasli / kumassiz ASAS
rem  sorgusunun suresini ve veri etkisini de olcer.
rem
rem  Buyer Log ayarlarina YAZMAZ. Kaynak Excel dosyalarinin kendisini
rem  degistirmez (kopyalari yenilenir). Buyer Log acikken calisabilir.
rem
rem  Bu dosyayi Buyer Log klasorune (BuyerLog.exe'nin yanina) koyun ya da
rem  resources\app\scripts icinden calistirin.
rem
rem  Gelismis kullanim (menuyu atlar):
rem    BuyerLog-Kaynak-Dogrulama.cmd --kumas ikisi --tekrar 3 --excel evet
rem ------------------------------------------------------------------

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "ROOT="
if exist "%HERE%\BuyerLog.exe" set "ROOT=%HERE%"
if not defined ROOT if exist "%HERE%\Buyer Log.exe" set "ROOT=%HERE%"
if not defined ROOT (
  for %%I in ("%HERE%\..\..\..") do set "UP=%%~fI"
  if exist "!UP!\BuyerLog.exe" set "ROOT=!UP!"
  if not defined ROOT if exist "!UP!\Buyer Log.exe" set "ROOT=!UP!"
)

echo.
echo ============================================================
echo  BUYER LOG - KAYNAK DOGRULAMA (ASAS / IAS / EXCEL)
echo ============================================================
echo.

if not defined ROOT (
  echo [HATA] BuyerLog.exe bulunamadi.
  echo Bu CMD dosyasini Buyer Log klasorune ^(BuyerLog.exe yanina^) koyun.
  pause
  exit /b 21
)
set "EXE=%ROOT%\BuyerLog.exe"
if not exist "%EXE%" set "EXE=%ROOT%\Buyer Log.exe"
set "SCRIPT=%ROOT%\resources\app\scripts\source-parity-check.js"
if not exist "%SCRIPT%" (
  echo [HATA] Bu Buyer Log surumu kaynak dogrulama aracini icermiyor:
  echo        %SCRIPT%
  echo Buyer Log'u bu araci iceren surume guncelleyip tekrar deneyin.
  pause
  exit /b 22
)

set "ARGS=%*"
if not "%ARGS%"=="" goto run

echo Kumas alanlari icin olcum:
echo   1 = Ikisi de ^(kumasli ve kumassiz ASAS sorgusunu karsilastir^) [onerilen]
echo   2 = Yalniz kumasli ^(bugunku BL davranisi^)
echo   3 = Yalniz kumassiz
set "K=1"
set /p "K=Seciminiz [1]: "
set "KUMAS=ikisi"
if "%K%"=="2" set "KUMAS=dahil"
if "%K%"=="3" set "KUMAS=haric"
echo.
echo Sure olcumu icin tekrar sayisi ^(1-5^). 3 onerilir; her tur IAS ve ASAS
echo sorgularini yeniden calistirir, toplam sure uzar.
set "N=1"
set /p "N=Tekrar [1]: "
echo.
echo Excel raporlarinin pivotu yenilenip karsilastirilsin mi? ^(Microsoft Excel gerekir^)
set "E=E"
set /p "E=Evet/Hayir [E]: "
set "EXCEL=evet"
if /I "%E%"=="H" set "EXCEL=hayir"
if /I "%E%"=="Hayir" set "EXCEL=hayir"
set "ARGS=--kumas %KUMAS% --tekrar %N% --excel %EXCEL%"

:run
echo.
echo Calisiyor... Database sorgulari ve Excel yenilemesi birkac dakika surebilir.
echo Bu pencereyi kapatmayin.
echo.
set "ELECTRON_RUN_AS_NODE=1"
"%EXE%" "%SCRIPT%" --root "%ROOT%" %ARGS%
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" echo SONUC: GECTI. Ayrintilar rapor klasorunde.
if "%RC%"=="1" echo SONUC: BASARISIZ - kaynaklar arasinda veri farki var. Rapor klasorundeki rapor.txt ve CSV dosyalarini inceleyin.
if "%RC%"=="2" echo SONUC: TEST TAMAMLANAMADI - yukaridaki [HATA] satirlarina bakin.
if exist "%ROOT%\Kaynak-Dogrulama-Raporlari" start "" "%ROOT%\Kaynak-Dogrulama-Raporlari"
pause
exit /b %RC%

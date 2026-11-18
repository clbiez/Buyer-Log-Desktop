'use strict';

/* Tek dosyalık BuyerLog-Kaynak-Dogrulama.cmd üretir: Windows komut başlığı +
   gömülü JS dosyaları. Kullanım: node tools/source-parity/build.js
   Çıktı: tools/source-parity/dist/BuyerLog-Kaynak-Dogrulama.cmd */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const FILES = ['compare.js', 'source-parity.js'];
const MARKER = '//@@BLFILE ';

const HEADER = String.raw`@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Buyer Log - Kaynak Dogrulama ve Yenileme Hiz Gunlugu

rem ------------------------------------------------------------------
rem  BUYER LOG'U DEGISTIRMEZ. Ayarlari yalniz okur; kaynak Excel'lerin
rem  kendisine dokunmaz (kopyalari yenilenir). Buyer Log acikken calisabilir.
rem
rem  Bu dosyayi Buyer Log klasorune (BuyerLog.exe'nin yanina) koyup
rem  cift tiklayin. Rapor: Kaynak-Dogrulama-Raporlari\<tarih>\
rem
rem  Menusuz kullanim:
rem    BuyerLog-Kaynak-Dogrulama.cmd --kumas ikisi --aday evet --tekrar 3 --excel evet
rem ------------------------------------------------------------------

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "EXE=%ROOT%\BuyerLog.exe"
if not exist "%EXE%" set "EXE=%ROOT%\Buyer Log.exe"

echo.
echo ============================================================
echo  BUYER LOG - KAYNAK DOGRULAMA VE YENILEME HIZ GUNLUGU
echo ============================================================
echo.

if not exist "%EXE%" (
  echo [HATA] BuyerLog.exe bulunamadi.
  echo Bu CMD dosyasini Buyer Log klasorune ^(BuyerLog.exe yanina^) koyun.
  pause
  exit /b 21
)

set "ARGS=%*"
if "%ARGS%"=="" (
  echo Kumas olcumu: ASAS sorgusu kumasli ve kumassiz calistirilip
  echo sure ve veri etkisi karsilastirilsin mi?
  set "K=E"
  set /p "K=Evet/Hayir [E]: "
  set "KUMAS=ikisi"
  set "K1=!K:~0,1!"
  if /I "!K1!"=="H" set "KUMAS=dahil"
  if /I "!K1!"=="N" set "KUMAS=dahil"
  echo.
  echo IAS aday sorgu ^(RELATED^) olculsun ve mevcut sorguyla karsilastirilsin mi?
  set "A=E"
  set /p "A=Evet/Hayir [E]: "
  set "ADAY=evet"
  set "A1=!A:~0,1!"
  if /I "!A1!"=="H" set "ADAY=hayir"
  if /I "!A1!"=="N" set "ADAY=hayir"
  echo.
  echo Sure olcumu icin tekrar sayisi ^(1-5^). 3 onerilir; sure uzar.
  set "N=1"
  set /p "N=Tekrar [1]: "
  echo.
  echo Excel raporlarinin pivotu yenilenip karsilastirilsin mi? ^(Excel gerekir^)
  set "E=E"
  set /p "E=Evet/Hayir [E]: "
  set "EXCEL=evet"
  set "E1=!E:~0,1!"
  if /I "!E1!"=="H" set "EXCEL=hayir"
  if /I "!E1!"=="N" set "EXCEL=hayir"
  set "ARGS=--kumas !KUMAS! --aday !ADAY! --tekrar !N! --excel !EXCEL!"
)

set "BL_WORK=%TEMP%\BuyerLog-Kaynak-Dogrulama-%RANDOM%%RANDOM%"
set "BL_SELF=%~f0"
mkdir "%BL_WORK%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:BL_SELF,[Text.Encoding]::UTF8); $m='//@@BL'+'FILE '; $p=$t.Split([string[]]@($m),[StringSplitOptions]::None); for($i=1;$i -lt $p.Length;$i++){ $s=$p[$i]; $n=$s.IndexOf([char]10); $name=$s.Substring(0,$n).Trim(); [IO.File]::WriteAllText((Join-Path $env:BL_WORK $name),$s.Substring($n+1),(New-Object Text.UTF8Encoding $false)) }"
if not exist "%BL_WORK%\source-parity.js" (
  echo [HATA] Arac dosyalari cikarilamadi ^(PowerShell^).
  pause
  exit /b 22
)

echo.
echo Calisiyor... Database sorgulari ve Excel yenilemesi dakikalar surebilir.
echo Bu pencereyi kapatmayin.
echo.
set "ELECTRON_RUN_AS_NODE=1"
"%EXE%" "%BL_WORK%\source-parity.js" --root "%ROOT%" %ARGS%
set "RC=%ERRORLEVEL%"
rmdir /s /q "%BL_WORK%" >nul 2>&1

echo.
if "%RC%"=="0" echo SONUC: GECTI. Ayrintilar rapor klasorunde ^(rapor.txt, performans.txt^).
if "%RC%"=="1" echo SONUC: BASARISIZ - kaynaklar arasinda veri farki var. rapor.txt ve CSV dosyalarina bakin.
if "%RC%"=="2" echo SONUC: TEST TAMAMLANAMADI - yukaridaki [HATA] satirlarina bakin.
if exist "%ROOT%\Kaynak-Dogrulama-Raporlari" start "" "%ROOT%\Kaynak-Dogrulama-Raporlari"
pause
exit /b %RC%
`;

function build() {
  const parts = [HEADER.replace(/\r?\n/g, '\r\n')];
  for (const name of FILES) {
    const body = fs.readFileSync(path.join(DIR, name), 'utf8');
    if (body.includes(MARKER)) throw new Error(`${name} işaretleyiciyi (${MARKER.trim()}) içeremez.`);
    const text = body.replace(/\r?\n/g, '\r\n');
    parts.push(`${MARKER}${name}\r\n${text.endsWith('\r\n') ? text : `${text}\r\n`}`);
  }
  const out = path.join(DIR, 'dist', 'BuyerLog-Kaynak-Dogrulama.cmd');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, parts.join(''), 'utf8');
  return out;
}

/* PowerShell çıkarma mantığının JS karşılığı (test için). */
function extract(cmdText) {
  const pieces = cmdText.split(MARKER);
  const files = {};
  for (let i = 1; i < pieces.length; i++) {
    const n = pieces[i].indexOf('\n');
    files[pieces[i].slice(0, n).trim()] = pieces[i].slice(n + 1);
  }
  return files;
}

module.exports = { build, extract, FILES, MARKER };
if (require.main === module) console.log(`Yazıldı: ${path.relative(process.cwd(), build())}`);

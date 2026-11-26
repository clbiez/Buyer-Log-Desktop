@echo off
rem Buyer Log yalitilmis dayaniklilik testi baslaticisi (Windows).
rem Kullanim: soak-start.cmd MAKINE "OneDrive\BuyerLogSoakHub" "C:\...\BuyerLog.exe" [ek argumanlar]
rem Ornek:    soak-start.cmd A "%USERPROFILE%\OneDrive\BuyerLogSoakHub" "D:\BuyerLog\BuyerLog.exe" --seed-password Soak-12345
setlocal
if "%~3"=="" (
  echo Kullanim: soak-start.cmd MAKINE "HUB_KLASORU" "BUYERLOG_EXE_YOLU" [--seed-password SIFRE]
  exit /b 1
)
if not exist "%~3" (
  echo BuyerLog.exe bulunamadi: "%~3"
  exit /b 1
)
rem Kurulu BuyerLog.exe yalniz Node calisma zamani olarak kullanilir; kurulum ve verisi degismez.
set ELECTRON_RUN_AS_NODE=1
"%~3" "%~dp0soak-start.js" --root "C:\BuyerLogSoak\%~1" --hub "%~2" --machine %~1 --install "%~dp3." %4 %5 %6 %7 %8 %9
endlocal

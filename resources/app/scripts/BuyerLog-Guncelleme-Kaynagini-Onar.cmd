@echo off
setlocal
title Buyer Log - Update Source Repair

set "ROOT=%~dp0"
if not exist "%ROOT%BuyerLog.exe" (
  echo.
  echo [ERROR] Place this file next to BuyerLog.exe and run it again.
  echo.
  pause
  exit /b 1
)

set "UPDATER_DIR=%ROOT%data\local\updater"
set "CONFIG_FILE=%UPDATER_DIR%\config.json"

if not exist "%UPDATER_DIR%" mkdir "%UPDATER_DIR%" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Updater folder could not be created:
  echo %UPDATER_DIR%
  echo.
  pause
  exit /b 1
)

> "%CONFIG_FILE%" (
  echo {
  echo   "enabled": true,
  echo   "releaseSource": "github:clbiez/Buyer-Log-Releases",
  echo   "channel": "test"
  echo }
)

if errorlevel 1 (
  echo.
  echo [ERROR] Update source could not be written.
  echo.
  pause
  exit /b 1
)

echo.
echo Buyer Log update source repaired.
echo Source : github:clbiez/Buyer-Log-Releases
echo Channel: TEST
echo.
echo Return to Buyer Log and click "Check for Update".
echo If Buyer Log was closed, open it normally.
echo.
pause
exit /b 0

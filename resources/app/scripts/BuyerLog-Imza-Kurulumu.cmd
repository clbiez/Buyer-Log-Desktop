@echo off
rem Buyer Log - guncelleme imzasi kurulumu (KISISEL bilgisayarda calistirin).
rem Yonetici yetkisi istemez, hicbir sey kurmaz.
cd /d "%~dp0.."
node scripts\setup-release-signing.js %*
echo.
pause

@echo off
setlocal EnableExtensions
chcp 65001 >nul

title Buyer Log Desktop - GitHub Sync

set "PROJECT_DIR=C:\Users\clbiez\Desktop\Buyer Log Desktop"
set "DEFAULT_REMOTE=https://github.com/clbiez/Buyer-Log.git"

echo.
echo ========================================
echo Buyer Log Desktop GitHub sync basliyor
echo ========================================
echo.

if not exist "%PROJECT_DIR%\" (
    echo [HATA] Proje klasoru bulunamadi:
    echo %PROJECT_DIR%
    echo.
    pause
    exit /b 1
)

cd /d "%PROJECT_DIR%"

where git >nul 2>&1
if errorlevel 1 (
    echo [HATA] Git bulunamadi. Git kurulu ve PATH icinde olmali.
    echo.
    pause
    exit /b 1
)

if not exist ".git\" (
    echo Git repository ilk kez olusturuluyor...
    git init
    if errorlevel 1 goto :error

    git branch -M main
    if errorlevel 1 goto :error
) else (
    echo Mevcut Git repository kullaniliyor...
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo Origin bulunamadi. Varsayilan GitHub repository baglantisi ekleniyor...
    git remote add origin "%DEFAULT_REMOTE%"
    if errorlevel 1 goto :error
) else (
    echo Mevcut origin korunuyor:
    git remote get-url origin
)

echo.
echo Dosyalar stage ediliyor...
git add -A
if errorlevel 1 goto :error

git diff --cached --quiet
if not errorlevel 1 (
    echo Degisiklik yok. Yeni commit olusturulmadi.
    goto :sync_remote
)

echo.
echo Commit olusturuluyor...
git commit -m "Buyer Log Desktop update"
if errorlevel 1 goto :error

:sync_remote
echo.
echo GitHub main branch kontrol ediliyor...
git ls-remote --exit-code --heads origin main >nul 2>&1

if errorlevel 1 (
    echo GitHub'da main branch henuz yok. Ilk push yapiliyor...
) else (
    echo GitHub'daki son degisiklikler guvenli sekilde aliniyor...
    git pull --rebase origin main
    if errorlevel 1 goto :pull_error
)

echo.
echo GitHub'a gonderiliyor...
git push -u origin main
if errorlevel 1 goto :error

echo.
echo ========================================
echo SYNC TAMAMLANDI
echo ========================================
echo.
pause
exit /b 0

:pull_error
echo.
echo [HATA] GitHub'daki degisikliklerle otomatik birlestirme yapilamadi.
echo Force push YAPILMADI; GitHub gecmisi korunuyor.
echo Conflictleri cozup dosyayi tekrar calistirin.
echo.
pause
exit /b 2

:error
echo.
echo [HATA] Git islemi basarisiz oldu.
echo Force push YAPILMADI; mevcut repository gecmisi korunuyor.
echo.
pause
exit /b 1

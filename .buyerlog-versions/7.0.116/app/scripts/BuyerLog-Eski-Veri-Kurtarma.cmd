@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

title Buyer Log - Guvenli Veri Kurtarma

rem ============================================================
rem Buyer Log Desktop - eski veriyi yeni portable data yapisina
rem guvenli sekilde geri getirir.
rem
rem - Admin/yukseltilmis yetki istemez.
rem - PowerShell kullanmaz.
rem - Kaynak data-BACKUP-20260921 klasorunu ASLA silmez.
rem - Hedef data klasoru bos degilse durur.
rem - Shared Hub / ag sync'i bilerek devreye ALMAZ.
rem ============================================================

set "ROOT=%~dp0"
set "BACKUP=%ROOT%data-BACKUP-20260921"
set "TARGET=%ROOT%data"
set "EVIDENCE=%TARGET%\migration-evidence"
set "LOG=%ROOT%BuyerLog-Veri-Kurtarma.log"
set "FAILED=0"

echo ============================================================ > "%LOG%"
echo BUYER LOG - GUVENLI VERI KURTARMA >> "%LOG%"
echo Baslangic: %DATE% %TIME% >> "%LOG%"
echo Kaynak : %BACKUP% >> "%LOG%"
echo Hedef  : %TARGET% >> "%LOG%"
echo ============================================================ >> "%LOG%"

echo.
echo ============================================================
echo  BUYER LOG - GUVENLI VERI KURTARMA
echo ============================================================
echo.

rem Buyer Log aciksa dur.
tasklist 2>nul | findstr /I /C:"BuyerLog.exe" /C:"Buyer Log.exe" >nul
if not errorlevel 1 (
  echo [DURDU] Buyer Log su anda acik.
  echo Buyer Log'u tamamen kapatin ve bu dosyayi tekrar calistirin.
  echo [DURDU] Buyer Log acik. >> "%LOG%"
  pause
  exit /b 20
)

if not exist "%BACKUP%\" (
  echo [HATA] data-BACKUP-20260921 bulunamadi.
  echo Bu CMD dosyasini Buyer Log Desktop ana klasorune koyun.
  echo [HATA] Kaynak klasor yok. >> "%LOG%"
  pause
  exit /b 21
)

if not exist "%TARGET%\" mkdir "%TARGET%" >nul 2>&1

for /f "delims=" %%A in ('dir /b /a "%TARGET%" 2^>nul') do (
  echo [HATA] Yeni data klasoru bos degil.
  echo Veri ezmemek icin islem durduruldu.
  echo [HATA] Hedef data bos degil: %%A >> "%LOG%"
  pause
  exit /b 22
)

mkdir "%TARGET%\app\auth" >nul 2>&1
mkdir "%TARGET%\server" >nul 2>&1
mkdir "%TARGET%\local" >nul 2>&1
mkdir "%EVIDENCE%\auth-candidates" >nul 2>&1

echo [1/6] Server verileri...
call :COPYDIR "%BACKUP%\server" "%TARGET%\server" "SERVER"

echo [2/6] App/kullanici verileri...
call :COPYDIR "%BACKUP%\app" "%TARGET%\app" "APP"

echo [3/6] Local DB, WAL, gorseller ve yerel dosyalar...
call :COPYDIR "%BACKUP%\local" "%TARGET%\local" "LOCAL"

rem Eski uygulama yapisinda resources\app\server\data icinde kalmis
rem dosyalar varsa YALNIZ eksik hedeflere ekle; var olan kurtarilan veriyi ezme.
if exist "%ROOT%resources\app\server\data\" (
  echo [4/6] Eski resources\app\server\data icinden eksikler tamamlaniyor...
  robocopy "%ROOT%resources\app\server\data" "%TARGET%\server" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /XC /XN /XO ^
    /XF "*.tmp" "*.old" "*.log" /XD ".buyerlog-db-recovery" "write-recovery" "runtime" "browser-profiles" "*.write-lock" ^
    /NP /NFL /NDL /NJH /NJS >> "%LOG%"
  set "RC=!ERRORLEVEL!"
  if !RC! GEQ 8 set "FAILED=1"
) else (
  echo [4/6] Eski resources server data bulunmadi; atlandi.
)

if "%FAILED%"=="1" (
  echo.
  echo [HATA] En az bir kopyalama islemi basarisiz.
  echo Kaynak data-BACKUP-20260921 DEGISTIRILMEDI.
  echo Ayrinti: %LOG%
  pause
  exit /b 30
)

rem Kullanici kimlikleri birden fazla eski yerde kalmis olabilir.
rem Tum adaylari sakla; en buyuk adayi etkin auth deposu yap.
echo [5/6] Kullanici kimlikleri aranip dogru konuma aliniyor...
set "BEST="
set "BESTDIR="
set /a BESTSIZE=0

call :AUTHCAND "%BACKUP%\app\auth\user-access.json" "backup-app-auth"
call :AUTHCAND "%BACKUP%\auth\user-access.json" "backup-old-auth"
call :AUTHCAND "%BACKUP%\server\user-access.json" "backup-server"
call :AUTHCAND "%BACKUP%\server\data\user-access.json" "backup-server-data"
call :AUTHCAND "%ROOT%resources\app\server\data\user-access.json" "resources-server-data"
call :AUTHCAND "%ROOT%resources\app\data\app\auth\user-access.json" "resources-app-auth"

if defined BEST (
  echo [OK] Secilen kullanici deposu:
  echo      !BEST!
  echo      !BESTSIZE! bayt
  echo [AUTH] Secilen=!BEST! Boyut=!BESTSIZE! >> "%LOG%"

  copy /y "!BEST!" "%TARGET%\app\auth\user-access.json" >nul
  if exist "!BEST!.bak" copy /y "!BEST!.bak" "%TARGET%\app\auth\user-access.json.bak" >nul

  for %%F in ("user-audit.jsonl" "iam-audit.json" "user-access.meta.json") do (
    if exist "!BESTDIR!\%%~F" copy /y "!BESTDIR!\%%~F" "%TARGET%\app\auth\%%~F" >nul
  )
) else (
  echo [UYARI] user-access.json bulunamadi.
  echo [UYARI] user-access.json adayi bulunamadi. >> "%LOG%"
)

rem Eski auth klasorunu kanit olarak koru; uygulama bunu canli depo olarak kullanmaz.
if exist "%BACKUP%\auth\" (
  robocopy "%BACKUP%\auth" "%EVIDENCE%\legacy-auth-folder" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NP /NFL /NDL /NJH /NJS >nul
)

rem Eski ag ayarlarini etkinlestirme. Once yerel veri dogrulanacak.
echo [6/6] Eski sync ayarlari karantinaya aliniyor...
if exist "%TARGET%\local\sync-settings.json" (
  move /y "%TARGET%\local\sync-settings.json" "%EVIDENCE%\sync-settings.pre-migration.json" >nul
  echo [OK] sync-settings karantinaya alindi.
)
if exist "%TARGET%\local\shared-hub-bootstrap.json" (
  move /y "%TARGET%\local\shared-hub-bootstrap.json" "%EVIDENCE%\shared-hub-bootstrap.pre-migration.json" >nul
  echo [OK] shared-hub-bootstrap karantinaya alindi.
)

echo.
echo ============================================================
echo  KURTARMA OZETI
echo ============================================================
call :CHECK "%TARGET%\app\auth\user-access.json" "Kullanici kimlikleri"
call :CHECK "%TARGET%\server\user-preferences\moderator.json" "Moderator tercihleri"
call :CHECK "%TARGET%\server\collection-workspaces\moderator.json" "Moderator Collection"
call :CHECK "%TARGET%\local\BuyerLogLocal.db" "Yerel DB"
call :CHECK "%TARGET%\local\BuyerLogLocal.db.wal" "Yerel DB WAL"

if exist "%TARGET%\server\user-preferences\" (
  for /f %%N in ('dir /b /a-d "%TARGET%\server\user-preferences\*.json" 2^>nul ^| find /c /v ""') do set "PREFCOUNT=%%N"
) else set "PREFCOUNT=0"

if exist "%TARGET%\server\collection-workspaces\" (
  for /f %%N in ('dir /b /a-d "%TARGET%\server\collection-workspaces\*.json" 2^>nul ^| find /c /v ""') do set "COLCOUNT=%%N"
) else set "COLCOUNT=0"

echo.
echo Kisisel tercih dosyasi sayisi : !PREFCOUNT!
echo Collection workspace sayisi   : !COLCOUNT!
echo.
echo Kaynak data-BACKUP-20260921 KORUNDU.
echo Shared Hub henuz etkin DEGIL.
echo.
echo Siradaki adim:
echo   1. Buyer Log'u acin.
echo   2. Gokberk/moderator ile giris yapin.
echo   3. User Management'ta eski kullanicilari kontrol edin.
echo   4. Collection ve kisisel ayarlarinizi kontrol edin.
echo   5. Sonra Sync ^& Local Data'dan BOS ortak ag klasorunu secin.
echo   6. Shared Hub Olustur ^> Test Connection ^> Save ^> Sync Now.
echo.
echo Log: %LOG%
echo.

echo Tamamlanma: %DATE% %TIME% >> "%LOG%"
echo TercihDosyasi=!PREFCOUNT! CollectionWorkspace=!COLCOUNT! >> "%LOG%"

set "EXE="
if exist "%ROOT%BuyerLog.exe" set "EXE=%ROOT%BuyerLog.exe"
if not defined EXE if exist "%ROOT%Buyer Log.exe" set "EXE=%ROOT%Buyer Log.exe"

if defined EXE (
  choice /C EH /N /M "Buyer Log simdi acilsin mi? [E=Evet / H=Hayir]: "
  if errorlevel 2 goto :DONE
  start "" "%EXE%"
)

:DONE
echo.
echo Islem tamamlandi.
pause
exit /b 0

:COPYDIR
set "SRC=%~1"
set "DST=%~2"
set "NAME=%~3"
if not exist "%SRC%\" (
  echo [BILGI] %NAME% kaynagi yok, atlandi.
  echo [BILGI] %NAME% yok: %SRC% >> "%LOG%"
  goto :eof
)
robocopy "%SRC%" "%DST%" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ ^
  /XF "*.tmp" "*.old" "*.log" ^
  /XD ".buyerlog-db-recovery" "write-recovery" "runtime" "browser-profiles" "*.write-lock" ^
  /NP /NFL /NDL /NJH /NJS >> "%LOG%"
set "RC=!ERRORLEVEL!"
if !RC! GEQ 8 (
  echo [HATA] %NAME% kopyasi basarisiz. Robocopy kodu: !RC!
  echo [HATA] %NAME% Robocopy=!RC! >> "%LOG%"
  set "FAILED=1"
) else (
  echo [OK] %NAME%
  echo [OK] %NAME% Robocopy=!RC! >> "%LOG%"
)
goto :eof

:AUTHCAND
set "CAND=%~1"
set "LABEL=%~2"
if not exist "%CAND%" goto :eof
for %%S in ("%CAND%") do set /a SZ=%%~zS
copy /y "%CAND%" "%EVIDENCE%\auth-candidates\%LABEL%-user-access.json" >nul
echo [AUTH ADAY] %LABEL% - !SZ! bayt - %CAND% >> "%LOG%"
if !SZ! GTR !BESTSIZE! (
  set /a BESTSIZE=!SZ!
  set "BEST=%CAND%"
  for %%D in ("%CAND%") do set "BESTDIR=%%~dpD"
)
goto :eof

:CHECK
if exist "%~1" (
  for %%S in ("%~1") do echo [OK] %~2 - %%~zS bayt
) else (
  echo [EKSIK] %~2
)
goto :eof

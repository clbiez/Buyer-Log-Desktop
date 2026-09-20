@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

title Buyer Log Desktop - GitHub Sync

set "PROJECT_DIR=C:\Users\clbiez\Desktop\Buyer Log Desktop"
set "DEFAULT_REMOTE=https://github.com/clbiez/Buyer-Log.git"
set "MAX_GITHUB_FILE_BYTES=104857600"

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
) else (
    echo Mevcut Git repository kullaniliyor...
)

echo Aktif branch main olarak ayarlaniyor...
git branch -M main
if errorlevel 1 goto :error

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
echo .gitignore kontrol ediliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='.gitignore';" ^
  "$rules=@('BuyerLog.exe','BuyerLog-Desktop-*.zip');" ^
  "if(Test-Path $p){$c=Get-Content -LiteralPath $p -ErrorAction Stop}else{$c=@()};" ^
  "$changed=$false;" ^
  "foreach($r in $rules){if(-not ($c -contains $r)){$c += $r;$changed=$true}};" ^
  "if($changed -or -not (Test-Path $p)){Set-Content -LiteralPath $p -Value $c -Encoding UTF8}" 
if errorlevel 1 goto :error

echo Buyuk build/release dosyalari Git indexinden cikariliyor...
git rm --cached --ignore-unmatch -- BuyerLog.exe >nul 2>&1
git rm --cached --ignore-unmatch -- "BuyerLog-Desktop-*.zip" >nul 2>&1

echo.
echo GitHub main branch kontrol ediliyor...
git ls-remote --exit-code --heads origin main >nul 2>&1
if errorlevel 1 (
    set "REMOTE_MAIN_EXISTS=0"
    echo GitHub'da main branch henuz yok.
) else (
    set "REMOTE_MAIN_EXISTS=1"
    echo GitHub main bulundu. Remote bilgiler aliniyor...
    git fetch origin main
    if errorlevel 1 goto :error
)

if "%REMOTE_MAIN_EXISTS%"=="1" (
    echo.
    echo Pushlanmamis commitlerde 100 MB ustu dosya kontrol ediliyor...

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$limit=%MAX_GITHUB_FILE_BYTES%;" ^
      "$bad=@();" ^
      "$lines = git rev-list --objects origin/main..HEAD 2>$null;" ^
      "foreach($line in $lines){" ^
      "  if([string]::IsNullOrWhiteSpace($line)){continue};" ^
      "  $parts=$line -split ' ',2;" ^
      "  $hash=$parts[0];" ^
      "  $path=if($parts.Count -gt 1){$parts[1]}else{''};" ^
      "  $type=(git cat-file -t $hash 2>$null);" ^
      "  if($LASTEXITCODE -eq 0 -and $type -eq 'blob'){" ^
      "    $size=[int64](git cat-file -s $hash 2>$null);" ^
      "    if($LASTEXITCODE -eq 0 -and $size -ge $limit){" ^
      "      $bad += [pscustomobject]@{Path=$path;Size=$size}" ^
      "    }" ^
      "  }" ^
      "};" ^
      "if($bad.Count -gt 0){" ^
      "  Write-Host '[UYARI] Yerel pushlanmamis commit gecmisinde GitHub limitini asan dosyalar bulundu:';" ^
      "  foreach($b in $bad){Write-Host ('  - {0} ({1:N2} MB)' -f $b.Path,($b.Size/1MB))};" ^
      "  exit 10" ^
      "} else { exit 0 }"

    if errorlevel 10 (
        echo.
        set "BACKUP_BRANCH=backup-before-large-file-cleanup-%RANDOM%-%RANDOM%"
        echo Guvenlik yedegi olusturuluyor: !BACKUP_BRANCH!
        git branch "!BACKUP_BRANCH!"
        if errorlevel 1 goto :error

        echo Yerel pushlanmamis commitler origin/main uzerine guvenli sekilde yeniden hazirlaniyor...
        git reset --mixed origin/main
        if errorlevel 1 goto :error

        echo Buyuk build/release dosyalari tekrar index disinda tutuluyor...
        git rm --cached --ignore-unmatch -- BuyerLog.exe >nul 2>&1
        git rm --cached --ignore-unmatch -- "BuyerLog-Desktop-*.zip" >nul 2>&1
    )
)

echo.
echo Dosyalar stage ediliyor...
git add -A
if errorlevel 1 goto :error

echo.
echo Stage edilen dosyalarda GitHub 100 MB limiti kontrol ediliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$limit=%MAX_GITHUB_FILE_BYTES%;" ^
  "$bad=@();" ^
  "$files = git diff --cached --name-only --diff-filter=ACMR;" ^
  "foreach($f in $files){" ^
  "  if(Test-Path -LiteralPath $f){" ^
  "    $item=Get-Item -LiteralPath $f -ErrorAction SilentlyContinue;" ^
  "    if($null -ne $item -and -not $item.PSIsContainer -and $item.Length -ge $limit){" ^
  "      $bad += $item" ^
  "    }" ^
  "  }" ^
  "};" ^
  "if($bad.Count -gt 0){" ^
  "  Write-Host '[HATA] Asagidaki dosyalar 100 MB veya daha buyuk ve GitHub repo pushunu engeller:';" ^
  "  foreach($b in $bad){Write-Host ('  - {0} ({1:N2} MB)' -f $b.FullName,($b.Length/1MB))};" ^
  "  Write-Host 'Bu dosyalari .gitignore ile dislayin veya GitHub Release asset olarak yayinlayin.';" ^
  "  exit 20" ^
  "} else { exit 0 }"
if errorlevel 20 goto :large_file_error
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
if "%REMOTE_MAIN_EXISTS%"=="1" (
    echo GitHub'daki son degisiklikler guvenli sekilde aliniyor...
    git pull --rebase origin main
    if errorlevel 1 goto :pull_error
) else (
    echo Ilk push hazirlaniyor...
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
echo Not: BuyerLog.exe ve BuyerLog-Desktop-*.zip repository'ye gonderilmez.
echo Buyuk kurulum/guncelleme paketlerini GitHub Releases uzerinden yayinlayin.
echo.
pause
exit /b 0

:large_file_error
echo.
echo [HATA] Stage alaninda GitHub'in 100 MB limitini asan dosya bulundu.
echo Push YAPILMADI. Dosyalariniz silinmedi.
echo.
pause
exit /b 3

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

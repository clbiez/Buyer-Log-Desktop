param(
  [ValidateSet('Update','Check','Rollback','Status')]
  [string]$Action = 'Update',
  [string]$InstallPath = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexUrl = 'https://raw.githubusercontent.com/clbiez/Buyer-Log-Releases/main/mini-patch/latest.json'
$releaseRoot = 'https://github.com/clbiez/Buyer-Log-Releases/releases/download/'
$settingsFile = Join-Path $scriptRoot 'BuyerLog-OtoPatch-settings.json'
$latestManifestFile = Join-Path $scriptRoot 'patch-manifest.json'
$installerFile = Join-Path $scriptRoot 'Apply-MiniPatch.ps1'
$cacheRoot = Join-Path $scriptRoot '.buyerlog-manualpatch-cache'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Save-Text([string]$p,[string]$s) {
  [System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))
}
function Read-Json([string]$p) {
  return ([System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
}
function Hex-File([string]$p) {
  return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Find-Installation {
  $c = $InstallPath
  if (-not $c) {
    foreach ($folder in @($scriptRoot, (Split-Path -Parent $scriptRoot))) {
      if ($folder -and (Test-Path -LiteralPath (Join-Path $folder 'BuyerLog.exe') -PathType Leaf)) {
        $c = $folder; break
      }
    }
  }
  if (-not $c -and (Test-Path -LiteralPath $settingsFile -PathType Leaf)) {
    $saved = Read-Json $settingsFile
    if ($saved.installPath) { $c = [string]$saved.installPath }
  }
  if (-not $c) {
    Write-Host 'BuyerLog.exe dosyasinin bulundugu KURULUM klasorunu girin:'
    $c = Read-Host 'Klasor'
  }
  $c = [string]$c
  $c = $c.Trim().Trim('"')
  if (-not (Test-Path -LiteralPath $c -PathType Container)) {
    throw "Kurulum klasoru bulunamadi: $c"
  }
  $p = (Resolve-Path -LiteralPath $c).ProviderPath
  if (-not (Test-Path -LiteralPath (Join-Path $p 'BuyerLog.exe') -PathType Leaf)) {
    throw "Klasorde BuyerLog.exe bulunamadi: $p"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $p 'resources\app\package.json') -PathType Leaf)) {
    throw 'Gecerli Buyer Log uygulama dosyalari bulunamadi.'
  }
  Save-Text $settingsFile ((@{installPath=$p} | ConvertTo-Json -Compress))
  return $p
}
function Get-ActiveVersion([string]$root) {
  $pointerFile = Join-Path $root 'data\local\updater\current.json'
  if (Test-Path -LiteralPath $pointerFile -PathType Leaf) {
    $pointer=Read-Json $pointerFile
    if ([string]$pointer.version -match '^[0-9]+\.[0-9]+\.[0-9]+$') {
      return [string]$pointer.version
    }
  }
  $pkg = Read-Json (Join-Path $root 'resources\app\package.json')
  if ([string]$pkg.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    throw 'Kurulum surumu belirlenemedi.'
  }
  return [string]$pkg.version
}
function Download([string]$url,[string]$dest) {
  $err = ''
  for ($i=1;$i -le 3;$i++) {
    try {
      if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
      Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -TimeoutSec 120 -Headers @{'User-Agent'='BuyerLog-Offline-Patch-Manager/1.0';'Accept'='application/octet-stream'} | Out-Null
      if ((Get-Item -LiteralPath $dest).Length -lt 10) { throw 'Sunucu bos yanit verdi.' }
      return
    } catch {
      $err = $_.Exception.Message
      if ($i -lt 3) { Start-Sleep -Seconds 2 }
    }
  }
  throw ("Indirme basarisiz: " + $err + [Environment]::NewLine +
         "GitHub / GitHub Releases kurum aginda engelliyse proxy/izin gerekebilir.")
}
function Get-Index {
  [IO.Directory]::CreateDirectory($cacheRoot) | Out-Null
  $temp = Join-Path $cacheRoot 'latest-index.download'
  Download ($indexUrl + '?refresh=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) $temp
  $obj = Read-Json $temp
  if ([int]$obj.schema -ne 1 -or [string]$obj.kind -ne 'buyerlog-manual-hotfix' -or
      [string]$obj.base_version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
      [string]$obj.target_commit -notmatch '^[0-9a-f]{40}$' -or
      [string]$obj.sha256 -notmatch '^[0-9a-f]{64}$' -or
      [string]$obj.asset -ne ("BuyerLog-" + [string]$obj.base_version + "-MiniPatch-" + ([string]$obj.target_commit).Substring(0,12) + ".zip") -or
      [long]$obj.size -lt 1024 -or [long]$obj.size -gt 50000000) {
    throw 'Kaynak index bilgisi beklenen semaya uymuyor. Islem durduruldu.'
  }
  return $obj
}
function Get-PackageManifest([string]$file) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($file)
  try {
    $entry = $archive.GetEntry('patch-manifest.json')
    if (-not $entry -or $entry.Length -gt 20000000) { throw 'ZIP manifest dosyasi gecersiz.' }
    $stream = $entry.Open()
    try {
      $reader = New-Object System.IO.StreamReader($stream, (New-Object System.Text.UTF8Encoding($false)))
      try { return $reader.ReadToEnd() }
      finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
  } finally { $archive.Dispose() }
}
function Apply-Local([string]$install,[string]$operation) {
  if (-not (Test-Path -LiteralPath $installerFile -PathType Leaf)) {
    throw "Yerel guvenli kurucu dosyasi eksik: $installerFile"
  }
  $argv = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installerFile,'-InstallPath',$install)
  if ($operation -eq 'Check') { $argv += '-Check' }
  if ($operation -eq 'Rollback') { $argv += '-Rollback' }
  if ($operation -ne 'Check') { $argv += '-Yes' }
  & powershell.exe @argv
  if ($LASTEXITCODE -ne 0) { throw "Patch $operation islemi hata koduyla bitti: $LASTEXITCODE" }
}
try {
  Write-Host ''
  Write-Host '=============================================================='
  Write-Host ' BUYER LOG - OTOMATIK MINI PATCH / GERI ALMA'
  Write-Host '=============================================================='
  $install = Find-Installation
  $activeVersion = Get-ActiveVersion $install
  Write-Host "Kurulum: $install"
  Write-Host "Etkin STABLE surum: $activeVersion"
  if ($Action -eq 'Rollback') {
    if (-not (Test-Path -LiteralPath $latestManifestFile)) {
      throw 'Geri alma manifesti bulunamadi. Once bu aracla bir patch uygulanmis olmali.'
    }
    Apply-Local $install 'Rollback'
    exit 0
  }
  if ($Action -eq 'Status') {
    if (Test-Path -LiteralPath $latestManifestFile) {
      $last=Read-Json $latestManifestFile
      Write-Host "Son indirilen patch: $($last.target_commit)"
    }
    $backups = Join-Path $install 'data\local\manual-patch-backups'
    $count=@(Get-ChildItem -LiteralPath $backups -Directory -ErrorAction SilentlyContinue |
             Where-Object { Test-Path (Join-Path $_.FullName 'backup.json') }).Count
    Write-Host "Geri alinabilir manuel patch: $count"
    exit 0
  }
  $idx = Get-Index
  if ([string]$idx.base_version -ne $activeVersion) {
    throw ("Yayindaki mini patch $($idx.base_version) icin; etkin surum $activeVersion. " +
      "Farkli STABLE surumlerinin dosyalari karistirilmaz. " +
      "Buyer Log'un resmi updater'i ile STABLE surumunu guncelleyin; " +
      "yeni surum icin patch yayimlanana kadar manuel dosya degisikligi yapilmaz.")
  }
  Write-Host "Yayindaki hedef commit: $($idx.target_commit)"
  Write-Host "Yayin zamani (UTC): $($idx.published_at_utc)"
  $zipFile = Join-Path $cacheRoot ([string]$idx.asset)
  $valid = (Test-Path -LiteralPath $zipFile -PathType Leaf) -and
           ((Get-Item -LiteralPath $zipFile).Length -eq [long]$idx.size)
  if ($valid) { $valid = (Hex-File $zipFile) -eq [string]$idx.sha256 }
  if (-not $valid) {
    Write-Host 'Guncel patch indiriliyor ve dogrulaniyor...'
    $temp=$zipFile + '.partial'
    Download ($releaseRoot + "minipatch-v" + [string]$idx.base_version + "/" + [string]$idx.asset) $temp
    if ((Get-Item -LiteralPath $temp).Length -ne [long]$idx.size -or
        (Hex-File $temp) -ne [string]$idx.sha256) {
      Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
      throw 'Indirilen ZIP SHA256 / boyut dogrulamasindan gecemedi. Dosyalar degistirilmedi.'
    }
    Move-Item -LiteralPath $temp -Destination $zipFile -Force
  }
  $manifestJson = Get-PackageManifest $zipFile
  $manifest = $manifestJson | ConvertFrom-Json
  if ([int]$manifest.schema -ne 2 -or [string]$manifest.base_version -ne [string]$idx.base_version -or
      [string]$manifest.target_commit -ne [string]$idx.target_commit -or
      @($manifest.files).Count -lt 1 -or @($manifest.files).Count -gt 200) {
    throw 'ZIP manifesti yayin indeksiyle eslesmiyor. Dosyalar degistirilmedi.'
  }
  # Preserve the manifest locally for fully offline rollback. No downloaded scripts are executed.
  Save-Text $latestManifestFile $manifestJson
  if ($Action -eq 'Check') {
    Apply-Local $install 'Check'
  } else {
    Apply-Local $install 'Update'
  }
  Write-Host "Patch kontrol edildi: $($idx.target_commit)"
} catch {
  Write-Host ''
  Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

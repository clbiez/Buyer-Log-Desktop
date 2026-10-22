param(
  [string]$InstallPath = '',
  [switch]$Check,
  [switch]$Rollback,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ExpectedVersion = '7.0.293'
$PatchFolder = Split-Path -Parent $MyInvocation.MyCommand.Path

function Hash-Hex([byte[]] $Bytes) {
  $h = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $h.Dispose() }
}
function Read-Json([string] $Path) {
  return (Get-Content -LiteralPath $Path -Encoding UTF8 -Raw | ConvertFrom-Json)
}
function Write-Utf8Json([string] $Path, $Obj) {
  $str = ConvertTo-Json -InputObject $Obj -Depth 20
  [System.IO.File]::WriteAllText($Path, $str, (New-Object System.Text.UTF8Encoding($false)))
}
function Under-Root([string] $Path, [string] $Root) {
  $p = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
  $r = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  return ($p.StartsWith($r + '\', [System.StringComparison]::OrdinalIgnoreCase))
}
function Find-Install {
  $candidate = $InstallPath
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    Write-Host 'BuyerLog.exe bulunan KURULUM klasorunu girin (or: C:\BuyerLog):'
    $candidate = Read-Host 'Klasor'
  }
  $candidate = $candidate.Trim().Trim('"')
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { throw "Klasor bulunamadi: $candidate" }
  $root = (Resolve-Path -LiteralPath $candidate).ProviderPath
  if (-not (Test-Path -LiteralPath (Join-Path $root 'BuyerLog.exe') -PathType Leaf)) {
    throw "Bu konumda BuyerLog.exe yok: $root"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'resources\app\package.json') -PathType Leaf)) {
    throw 'Gecerli Buyer Log app-core klasoru bulunamadi.'
  }
  return $root
}
function Active-Core([string] $Root) {
  $core = Join-Path $Root 'resources\app'
  $pointerPath = Join-Path $Root 'data\local\updater\current.json'
  if (Test-Path -LiteralPath $pointerPath -PathType Leaf) {
    $pointer = Read-Json $pointerPath
    if ($pointer.version -and ([string]$pointer.version -ne $ExpectedVersion)) {
      throw "Etkin surum $($pointer.version); mini patch yalniz 7.0.293 icindir."
    }
    if ($pointer.appCoreRoot) {
      $proposed = [string] $pointer.appCoreRoot
      if ((Under-Root $proposed $Root) -and
          (Test-Path -LiteralPath (Join-Path $proposed 'package.json') -PathType Leaf)) {
        $core = (Resolve-Path -LiteralPath $proposed).ProviderPath
      } else {
        $fallback = Join-Path $Root '.buyerlog-versions\7.0.293\app'
        if ((Test-Path -LiteralPath (Join-Path $fallback 'package.json') -PathType Leaf)) {
          $core = (Resolve-Path -LiteralPath $fallback).ProviderPath
        }
      }
    }
  }
  $pkg = Read-Json (Join-Path $core 'package.json')
  if ([string]$pkg.version -ne $ExpectedVersion) {
    throw "Gecerli olmayan uygulama surumu: $($pkg.version). Beklenen: 7.0.293"
  }
  $statePath = Join-Path $Root 'data\local\updater\state.json'
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    $state = Read-Json $statePath
    if ($state.pending -and $state.pending.ready -eq $true) {
      throw 'Resmi bir update zaten kuruluma hazir. Once resmi update islemini tamamlayin.'
    }
    if ($state.activation -and $state.activation.status -eq 'trial') {
      throw 'Guncelleme trial durumda. Trial tamamlanmadan manuel patch uygulanmaz.'
    }
  }
  return $core
}
function Assert-Closed {
  if (Get-Process -Name BuyerLog -ErrorAction SilentlyContinue) {
    throw 'Buyer Log calisiyor. Tum BuyerLog.exe oturumlarini kapatin ve tekrar deneyin.'
  }
}
function To-Lines([string] $Text) {
  $result = New-Object 'System.Collections.Generic.List[string]'
  foreach ($m in [regex]::Matches($Text, '[^\n]*(?:\n|$)')) {
    if ($m.Value.Length -gt 0) { $result.Add([string]$m.Value) }
  }
  return ,$result
}
function Patch-Bytes([byte[]] $Source, $Variant, [string] $Relative) {
  $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
  $text = $utf8.GetString($Source)
  $lines = To-Lines $text
  $edits = @($Variant.edits)
  for ($i = $edits.Count - 1; $i -ge 0; $i--) {
    $edit = $edits[$i]
    $start = [int]$edit[0]
    $count = [int]$edit[1]
    $insert = [string[]]@($edit[2])
    if ($start -lt 0 -or $count -lt 0 -or $start + $count -gt $lines.Count) {
      throw "Patch satir siniri disinda: $Relative, $start/$count"
    }
    if ($count -gt 0) { $lines.RemoveRange($start, $count) }
    if ($insert.Count -gt 0) { $lines.InsertRange($start, $insert) }
  }
  $updatedText = [string]::Concat([string[]]$lines.ToArray())
  return $utf8.GetBytes($updatedText)
}
function Safe-Target([string] $Core, [string] $Relative, [bool] $AllowMissing = $false) {
  if ($Relative -notmatch '^(public|server)/' -or
      $Relative -match '(^|/)\.\.?(/|$)' -or $Relative -match '(?i)(electron|updater|update|package\.json|config\.json)' -or
      [System.IO.Path]::IsPathRooted($Relative)) {
    throw "Guvenlik filtresine takilan patch yolu: $Relative"
  }
  $target = Join-Path $Core ($Relative.Replace('/', '\'))
  if (-not (Under-Root $target $Core)) { throw "Patch yolu kurulum disinda: $Relative" }
  if ((-not $AllowMissing) -and (-not (Test-Path -LiteralPath $target -PathType Leaf))) { throw "Eksik dosya: $target" }
  return $target
}
function Main {
  $manifest = Read-Json (Join-Path $PatchFolder 'patch-manifest.json')
  if ([int]$manifest.schema -ne 2 -or [string]$manifest.base_version -ne $ExpectedVersion -or
      [string]$manifest.target_commit -notmatch '^[0-9a-f]{40}
    throw 'Patch manifesti surum veya sema acisindan uyumsuz.'
  }
  if (@($manifest.files).Count -lt 1 -or @($manifest.files).Count -gt 200) { throw 'Patch manifesti dosya sayisi gecersiz.' }
  $root = Find-Install
  $core = Active-Core $root
  Write-Host ''
  Write-Host 'Buyer Log 7.0.293 MINI PATCH'
  Write-Host "Kurulum: $root"
  Write-Host "Aktif cekirdek: $core"
  Write-Host "Kaynak: $($manifest.base_commit.Substring(0,8)) -> $($manifest.target_commit.Substring(0,8))"
  if ($Rollback) {
    Assert-Closed
    $history = Join-Path $root 'data\local\manual-patch-backups'
    $last = Get-ChildItem -LiteralPath $history -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'backup.json') } |
      Sort-Object Name -Descending | Select-Object -First 1
    if (-not $last) { throw 'Geri alinacak mini patch yedegi bulunamadi.' }
    $backup = Read-Json (Join-Path $last.FullName 'backup.json')
    if ([string]$backup.core -ne [string]$core) { throw 'Yedek baska bir aktif cekirdege ait.' }
    $restoreItems = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in @($backup.files)) {
      $target = Safe-Target $core ([string]$item.path)
      $currentHash = Hash-Hex ([System.IO.File]::ReadAllBytes($target))
      if ($currentHash -ne [string]$item.after_sha256) {
        throw "Geri alma durduruldu; dosya sonradan degismis: $($item.path)"
      }
      if ([string]$item.kind -eq 'added') {
        $restoreItems.Add(@{kind='added'; target=$target; saved='' })
        continue
      }
      $saved = Join-Path $last.FullName ([string]$item.path).Replace('/', '\')
      if (-not (Test-Path -LiteralPath $saved -PathType Leaf)) { throw "Yedek eksik: $saved" }
      if ((Hash-Hex ([System.IO.File]::ReadAllBytes($saved))) -ne [string]$item.before_sha256) {
        throw "Yedegin kimligi hatali: $($item.path)"
      }
      $restoreItems.Add(@{kind='modified'; target=$target; saved=$saved})
    }
    $answer = if ($Yes) { "E" } else { Read-Host "Son yedek geri yuklenecek ($($restoreItems.Count) dosya). Devam E/H?" }
    if ($answer -notmatch '^[eEyY]') { Write-Host 'Iptal edildi.'; return }
    foreach ($i in $restoreItems) {
      if ($i.kind -eq 'added') { Remove-Item -LiteralPath $i.target -Force }
      else { [System.IO.File]::Copy($i.saved, $i.target, $true) }
    }
    Rename-Item -LiteralPath (Join-Path $last.FullName 'backup.json') -NewName 'backup.restored.json'
    Write-Host 'Geri alma tamamlandi.'
    return
  }
  $changes = New-Object 'System.Collections.Generic.List[object]'
  $already = 0
  foreach ($record in @($manifest.files)) {
    $relative = [string]$record.path
    $kind = [string]$record.kind
    if ($kind -notin @('added','modified')) {
      throw "Taninmayan patch tipi: $relative"
    }
    $target = Safe-Target $core $relative ($kind -eq 'added')
    if ($kind -eq 'added' -and -not (Test-Path -LiteralPath $target -PathType Leaf)) {
      $updated = [System.Convert]::FromBase64String([string]$record.payload_b64)
      if ((Hash-Hex $updated) -ne [string]$record.after_sha256) {
        throw "PATCH DURDURULDU: yeni dosya SHA256 hatasi: $relative"
      }
      $changes.Add(@{kind=$kind;path=$relative;target=$target;bytes=$updated;record=$record;before_sha256='' })
      continue
    }
    $bytes = [System.IO.File]::ReadAllBytes($target)
    $current = Hash-Hex $bytes
    if ($current -eq [string]$record.after_sha256) {
      $already++
      continue
    }
    $variant = @($record.variants) | Where-Object { [string]$_.before_sha256 -eq $current } | Select-Object -First 1
    if (-not $variant) {
      throw "PATCH DURDURULDU: '$relative' eski veya onceki patch dosyasiyla eslesmiyor. Hicbir dosya degistirilmedi."
    }
    $updated = Patch-Bytes $bytes $variant $relative
    if ((Hash-Hex $updated) -ne [string]$record.after_sha256) {
      throw "PATCH DURDURULDU: '$relative' sonuc kimligi dogrulanamadi."
    }
    # A new upstream file may already exist from an earlier manual patch.
    # Update and back it up as an existing file to make rollback lossless.
    $effectiveKind = 'modified'
    $changes.Add(@{kind=$effectiveKind;path=$relative;target=$target;bytes=$updated;record=$record;before_sha256=$current})
  }
  Write-Host "Yazilacak dosya: $($changes.Count); zaten guncel: $already"
  Write-Host 'Updater / launcher / version / data / veritabani: DOKUNULMUYOR'
  if ($Check) { Write-Host 'Kontrol basarili. Hicbir dosya degistirilmedi.'; return }
  if ($changes.Count -eq 0) { Write-Host 'Patch zaten uygulanmis.'; return }
  Assert-Closed
  $answer = if ($Yes) { 'E' } else { Read-Host 'Tum kontroller temiz. Mini patch uygulansin mi? E/H' }
  if ($answer -notmatch '^[eEyY]') { Write-Host 'Iptal edildi.'; return }

  $history = Join-Path $root 'data\local\manual-patch-backups'
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss-fffffff')
  $backupRoot = Join-Path $history ("patch-7.0.293-" + $stamp)
  [System.IO.Directory]::CreateDirectory($backupRoot) | Out-Null
  $backupItems = New-Object 'System.Collections.Generic.List[object]'
  foreach ($change in $changes) {
    $backupPath = Join-Path $backupRoot ($change.path.Replace('/', '\'))
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $backupPath)) | Out-Null
    if ($change.kind -eq 'modified') {
      [System.IO.File]::Copy($change.target, $backupPath, $false)
    }
    $backupItems.Add(@{
      kind=$change.kind
      path=$change.path
      before_sha256=[string]$change.before_sha256
      after_sha256=[string]$change.record.after_sha256
    })
  }
  Write-Utf8Json (Join-Path $backupRoot 'backup.json') @{
    base_version=$ExpectedVersion; core=$core; base_commit=$manifest.base_commit;
    target_commit=$manifest.target_commit; created_at=(Get-Date).ToString('o');
    files=@($backupItems.ToArray())
  }
  $applied = New-Object 'System.Collections.Generic.List[object]'
  try {
    foreach ($change in $changes) {
      $temporary = $change.target + '.manualpatch-' + [guid]::NewGuid().ToString('N')
      try {
        [System.IO.File]::WriteAllBytes($temporary, [byte[]]$change.bytes)
        if ($change.kind -eq 'added') {
          [System.IO.File]::Move($temporary, $change.target)
        } else {
          [System.IO.File]::Replace($temporary, $change.target, (Join-Path $backupRoot ($change.path.Replace('/', '\'))))
        }
        $applied.Add($change)
      } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
      }
    }
  } catch {
    $reason = $_.Exception.Message
    $revertFailures = @()
    foreach ($change in $applied) {
      try {
        if ($change.kind -eq 'added') {
          Remove-Item -LiteralPath $change.target -Force
        } else {
          $saved = Join-Path $backupRoot ($change.path.Replace('/', '\'))
          [System.IO.File]::Copy($saved, $change.target, $true)
        }
      } catch { $revertFailures += [string]$change.path }
    }
    if ($revertFailures.Count -gt 0) {
      throw "UYGULAMA HATASI: $reason. Otomatik geri alma EKSIK: $($revertFailures -join ', '). Yedek: $backupRoot"
    }
    throw "UYGULAMA HATASI: $reason. Islenen dosyalar yedekten geri alindi."
  }
  Write-Host ''
  Write-Host "BASARILI: $($changes.Count) dosya guncellendi."
  Write-Host "Yedek: $backupRoot"
  Write-Host 'Resmi otomatik update mekanizmasi, launcher ve surum aynen korundu.'
}
try { Main } catch {
  Write-Host ''
  Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
) {
    throw 'Patch manifesti surum veya sema acisindan uyumsuz.'
  }
  if (@($manifest.files).Count -ne 52) { throw 'Patch manifesti eksik / bozuk (52 dosya bekleniyor).' }
  $root = Find-Install
  $core = Active-Core $root
  Write-Host ''
  Write-Host 'Buyer Log 7.0.293 MINI PATCH'
  Write-Host "Kurulum: $root"
  Write-Host "Aktif cekirdek: $core"
  Write-Host "Kaynak: $($manifest.base_commit.Substring(0,8)) -> $($manifest.target_commit.Substring(0,8))"
  if ($Rollback) {
    Assert-Closed
    $history = Join-Path $root 'data\local\manual-patch-backups'
    $last = Get-ChildItem -LiteralPath $history -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'backup.json') } |
      Sort-Object Name -Descending | Select-Object -First 1
    if (-not $last) { throw 'Geri alinacak mini patch yedegi bulunamadi.' }
    $backup = Read-Json (Join-Path $last.FullName 'backup.json')
    if ([string]$backup.core -ne [string]$core) { throw 'Yedek baska bir aktif cekirdege ait.' }
    $restoreItems = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in @($backup.files)) {
      $target = Safe-Target $core ([string]$item.path)
      $currentHash = Hash-Hex ([System.IO.File]::ReadAllBytes($target))
      if ($currentHash -ne [string]$item.after_sha256) {
        throw "Geri alma durduruldu; dosya sonradan degismis: $($item.path)"
      }
      if ([string]$item.kind -eq 'added') {
        $restoreItems.Add(@{kind='added'; target=$target; saved='' })
        continue
      }
      $saved = Join-Path $last.FullName ([string]$item.path).Replace('/', '\')
      if (-not (Test-Path -LiteralPath $saved -PathType Leaf)) { throw "Yedek eksik: $saved" }
      if ((Hash-Hex ([System.IO.File]::ReadAllBytes($saved))) -ne [string]$item.before_sha256) {
        throw "Yedegin kimligi hatali: $($item.path)"
      }
      $restoreItems.Add(@{kind='modified'; target=$target; saved=$saved})
    }
    $answer = Read-Host "Son yedek geri yuklenecek ($($restoreItems.Count) dosya). Devam E/H?"
    if ($answer -notmatch '^[eEyY]') { Write-Host 'Iptal edildi.'; return }
    foreach ($i in $restoreItems) {
      if ($i.kind -eq 'added') { Remove-Item -LiteralPath $i.target -Force }
      else { [System.IO.File]::Copy($i.saved, $i.target, $true) }
    }
    Rename-Item -LiteralPath (Join-Path $last.FullName 'backup.json') -NewName 'backup.restored.json'
    Write-Host 'Geri alma tamamlandi.'
    return
  }
  $changes = New-Object 'System.Collections.Generic.List[object]'
  $already = 0
  foreach ($record in @($manifest.files)) {
    $relative = [string]$record.path
    $kind = [string]$record.kind
    if ($kind -notin @('added','modified')) {
      throw "Taninmayan patch tipi: $relative"
    }
    $target = Safe-Target $core $relative ($kind -eq 'added')
    if ($kind -eq 'added' -and -not (Test-Path -LiteralPath $target -PathType Leaf)) {
      $updated = [System.Convert]::FromBase64String([string]$record.payload_b64)
      if ((Hash-Hex $updated) -ne [string]$record.after_sha256) {
        throw "PATCH DURDURULDU: yeni dosya SHA256 hatasi: $relative"
      }
      $changes.Add(@{kind=$kind;path=$relative;target=$target;bytes=$updated;record=$record;before_sha256='' })
      continue
    }
    $bytes = [System.IO.File]::ReadAllBytes($target)
    $current = Hash-Hex $bytes
    if ($current -eq [string]$record.after_sha256) {
      $already++
      continue
    }
    $variant = @($record.variants) | Where-Object { [string]$_.before_sha256 -eq $current } | Select-Object -First 1
    if (-not $variant) {
      throw "PATCH DURDURULDU: '$relative' eski veya onceki patch dosyasiyla eslesmiyor. Hicbir dosya degistirilmedi."
    }
    $updated = Patch-Bytes $bytes $variant $relative
    if ((Hash-Hex $updated) -ne [string]$record.after_sha256) {
      throw "PATCH DURDURULDU: '$relative' sonuc kimligi dogrulanamadi."
    }
    # A new upstream file may already exist from an earlier manual patch.
    # Update and back it up as an existing file to make rollback lossless.
    $effectiveKind = 'modified'
    $changes.Add(@{kind=$effectiveKind;path=$relative;target=$target;bytes=$updated;record=$record;before_sha256=$current})
  }
  Write-Host "Yazilacak dosya: $($changes.Count); zaten guncel: $already"
  Write-Host 'Updater / launcher / version / data / veritabani: DOKUNULMUYOR'
  if ($Check) { Write-Host 'Kontrol basarili. Hicbir dosya degistirilmedi.'; return }
  if ($changes.Count -eq 0) { Write-Host 'Patch zaten uygulanmis.'; return }
  Assert-Closed
  $answer = Read-Host 'Tum kontroller temiz. Mini patch uygulansin mi? E/H'
  if ($answer -notmatch '^[eEyY]') { Write-Host 'Iptal edildi.'; return }

  $history = Join-Path $root 'data\local\manual-patch-backups'
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss-fffffff')
  $backupRoot = Join-Path $history ("patch-7.0.293-" + $stamp)
  [System.IO.Directory]::CreateDirectory($backupRoot) | Out-Null
  $backupItems = New-Object 'System.Collections.Generic.List[object]'
  foreach ($change in $changes) {
    $backupPath = Join-Path $backupRoot ($change.path.Replace('/', '\'))
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $backupPath)) | Out-Null
    if ($change.kind -eq 'modified') {
      [System.IO.File]::Copy($change.target, $backupPath, $false)
    }
    $backupItems.Add(@{
      kind=$change.kind
      path=$change.path
      before_sha256=[string]$change.before_sha256
      after_sha256=[string]$change.record.after_sha256
    })
  }
  Write-Utf8Json (Join-Path $backupRoot 'backup.json') @{
    base_version=$ExpectedVersion; core=$core; base_commit=$manifest.base_commit;
    target_commit=$manifest.target_commit; created_at=(Get-Date).ToString('o');
    files=@($backupItems.ToArray())
  }
  $applied = New-Object 'System.Collections.Generic.List[object]'
  try {
    foreach ($change in $changes) {
      $temporary = $change.target + '.manualpatch-' + [guid]::NewGuid().ToString('N')
      try {
        [System.IO.File]::WriteAllBytes($temporary, [byte[]]$change.bytes)
        if ($change.kind -eq 'added') {
          [System.IO.File]::Move($temporary, $change.target)
        } else {
          [System.IO.File]::Replace($temporary, $change.target, (Join-Path $backupRoot ($change.path.Replace('/', '\'))))
        }
        $applied.Add($change)
      } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
      }
    }
  } catch {
    $reason = $_.Exception.Message
    $revertFailures = @()
    foreach ($change in $applied) {
      try {
        if ($change.kind -eq 'added') {
          Remove-Item -LiteralPath $change.target -Force
        } else {
          $saved = Join-Path $backupRoot ($change.path.Replace('/', '\'))
          [System.IO.File]::Copy($saved, $change.target, $true)
        }
      } catch { $revertFailures += [string]$change.path }
    }
    if ($revertFailures.Count -gt 0) {
      throw "UYGULAMA HATASI: $reason. Otomatik geri alma EKSIK: $($revertFailures -join ', '). Yedek: $backupRoot"
    }
    throw "UYGULAMA HATASI: $reason. Islenen dosyalar yedekten geri alindi."
  }
  Write-Host ''
  Write-Host "BASARILI: $($changes.Count) dosya guncellendi."
  Write-Host "Yedek: $backupRoot"
  Write-Host 'Surum 7.0.293 ve resmi otomatik update mekanizmasi aynen korundu.'
}
try { Main } catch {
  Write-Host ''
  Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

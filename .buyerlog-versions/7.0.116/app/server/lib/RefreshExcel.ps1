# RefreshExcel.ps1
# Verilen bir .xlsx dosyasını GERÇEK Excel ile (görünmez şekilde) açar, içindeki tüm
# pivot tabloları / veri bağlantılarını yeniler ("Verileri Yenile" ile aynı işlem),
# kaydeder ve kapatır. Node.js backend, "Yenile" butonuna basıldığında bu scripti
# ASAS ve Antrepo dosyaları için sırayla çalıştırır.
#
# Kullanım:  powershell -NoProfile -File RefreshExcel.ps1 "C:\yol\dosya.xlsx"
#
# ÖNEMLİ: Bu script kendi başlattığı Excel sürecinin PID'sini bir dosyaya (excel.pid)
# yazar ve işi bitince (veya bir kesinti/zaman aşımı olursa) o PID'nin GERÇEKTEN
# kapandığını doğrular; kapanmadıysa zorla sonlandırır. Bu, "ASAS/Antrepo dosyası
# başka bir programda açık" uyarısına sebep olan artık (orphan) Excel süreçlerini
# engellemek için var. Sadece BU SCRIPT'İN BAŞLATTIĞI süreç hedef alınır — senin
# elle açtığın başka bir Excel penceresine ASLA dokunulmaz.
#
# NOT: Bu makinede Microsoft Excel kurulu olmalı. Test edilmemiştir — ilk çalıştırmada
# gerçek bir dosyayla deneyip davranışını doğrulaman gerekiyor (bkz. proje README'si).

param(
  [Parameter(Mandatory=$true)]
  [string]$FilePath
)

$ErrorActionPreference = "Stop"
$PidFile = if ($env:BUYER_LOG_EXCEL_PID_FILE) {
  $env:BUYER_LOG_EXCEL_PID_FILE
} else {
  # Legacy/standalone çalıştırma için geriye dönük fallback.
  Join-Path $PSScriptRoot "..\data\excel.pid"
}
$PidFileDir = Split-Path $PidFile -Parent
if (-not (Test-Path $PidFileDir)) { New-Item -ItemType Directory -Path $PidFileDir -Force | Out-Null }

function Get-ExcelPids {
  @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

# Önceki bir çalıştırmadan kalan (kapanamamış) bir Excel süreci varsa önce onu temizle.
if (Test-Path $PidFile) {
  $oldPid = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    try { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Milliseconds 500
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

if (-not (Test-Path $FilePath)) {
  Write-Error "Dosya bulunamadı: $FilePath"
  exit 1
}
$FilePath = (Resolve-Path $FilePath).Path

$excel = $null
$workbook = $null
$ourExcelPid = $null
$totalWatch = [System.Diagnostics.Stopwatch]::StartNew()
$openMs = 0
$refreshMs = 0
$layoutMs = 0
$calculateMs = 0
$saveMs = 0
try {
  $before = Get-ExcelPids
  $excel = New-Object -ComObject Excel.Application
  Start-Sleep -Milliseconds 400
  $after = Get-ExcelPids
  $newPids = @($after | Where-Object { $before -notcontains $_ })
  if ($newPids.Count -ge 1) {
    $ourExcelPid = $newPids[0]
    Set-Content -Path $PidFile -Value $ourExcelPid -Force
  }

  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false

  $phaseWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $workbook = $excel.Workbooks.Open($FilePath, 0, $false)  # 0=UpdateLinks:hayır sorma, ReadOnly:false
  $phaseWatch.Stop(); $openMs = $phaseWatch.ElapsedMilliseconds

  # Önce tüm veri bağlantılarını / Power Query sorgularını yenile.
  $phaseWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $workbook.RefreshAll()

  # Arka planda (async) çalışan sorgular varsa tamamlanmalarını bekle. Pivot cache
  # yenilemesini bağlantılar bittikten SONRA yapmak önemlidir; aksi halde pivot tablo
  # eski cache üzerinden kaydedilebilir.
  try {
    $excel.CalculateUntilAsyncQueriesDone()
  } catch {
    Start-Sleep -Seconds 8
  }
  $phaseWatch.Stop(); $refreshMs = $phaseWatch.ElapsedMilliseconds

  # Workbook.RefreshAll hem bağlantıları hem PivotTable raporlarını yeniler. Bunun
  # ardından her PivotTable için tekrar RefreshTable çağırmak aynı OLAP sorgusunu
  # pivot sayısı kadar yeniden çalıştırıyor ve 30 saniyelik işi 500+ saniyeye
  # çıkarabiliyordu. Burada yalnız rapor düzeni korunur; ikinci veri sorgusu yoktur.
  $phaseWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $pivotTableCount = 0
  try {
    for ($si = 1; $si -le $workbook.Worksheets.Count; $si++) {
      $sheet = $workbook.Worksheets.Item($si)
      $pivots = $sheet.PivotTables()
      for ($pi = 1; $pi -le $pivots.Count; $pi++) {
        $pivot = $pivots.Item($pi)
        if ($null -eq $pivot) { continue }
        # Pivot dosyasında Repeat Labels zaten açık olsa da refresh sonrası Excel'in
        # satır etiketlerini boş bırakmaması için açıkça uygula (xlRepeatLabels = 2).
        try { $pivot.RepeatAllLabels(2) | Out-Null } catch {}
        $pivotTableCount++
        try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($pivot) | Out-Null } catch {}
      }
      try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($pivots) | Out-Null } catch {}
      try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) | Out-Null } catch {}
    }
  } catch {
    throw "PivotTable düzeni korunamadı: $($_.Exception.Message)"
  }
  $phaseWatch.Stop(); $layoutMs = $phaseWatch.ElapsedMilliseconds

  # CalculateFullRebuild bütün bağımlılık ağacını sıfırdan kurar ve büyük Antrepo
  # dosyalarında dakikalar sürebilir. RefreshAll sonrası normal hesaplama güncel
  # pivot sonuçlarına bağlı formüller için yeterlidir.
  $phaseWatch = [System.Diagnostics.Stopwatch]::StartNew()
  try { $excel.Calculate() } catch { try { $workbook.Worksheets.Calculate() } catch {} }
  try { $excel.CalculateUntilAsyncQueriesDone() } catch {}
  $phaseWatch.Stop(); $calculateMs = $phaseWatch.ElapsedMilliseconds

  $phaseWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $workbook.Save()
  $phaseWatch.Stop(); $saveMs = $phaseWatch.ElapsedMilliseconds
  $totalWatch.Stop()
  Write-Output "OK: $FilePath yenilendi ve kaydedildi. PivotTable=$pivotTableCount RepeatLabels=On OpenMs=$openMs RefreshMs=$refreshMs LayoutMs=$layoutMs CalculateMs=$calculateMs SaveMs=$saveMs TotalMs=$($totalWatch.ElapsedMilliseconds)"
}
catch {
  Write-Error "Yenileme hatası ($FilePath): $($_.Exception.Message)"
  exit 1
}
finally {
  if ($workbook) {
    try { $workbook.Close($false) } catch {}
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
  }
  if ($excel) {
    try { $excel.Quit() } catch {}
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()

  # Quit() her zaman süreci gerçekten sonlandırmayabilir (COM "zombie" süreç kalabilir).
  # Kısa bir bekleme sonrası hâlâ çalışıyorsa, SADECE bizim başlattığımız bu PID'yi
  # zorla kapat — başka hiçbir Excel penceresine dokunulmaz.
  if ($ourExcelPid) {
    Start-Sleep -Milliseconds 800
    if (Get-Process -Id $ourExcelPid -ErrorAction SilentlyContinue) {
      try { Stop-Process -Id $ourExcelPid -Force -ErrorAction SilentlyContinue } catch {}
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
  }
}

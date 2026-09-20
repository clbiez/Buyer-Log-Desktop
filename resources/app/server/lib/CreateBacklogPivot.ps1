# CreateBacklogPivot.ps1
# xlsx-js-style ile hazırlanmış BACKLOG + PivotData çalışma kitabına Microsoft Excel COM
# üzerinden GERÇEK, düzenlenebilir bir PivotTable ekler. Böylece alan listesi, filtreler,
# satır/sütun alanlarını sürükleme ve +/- genişlet-daralt işlevleri dosyada korunur.

param(
  [Parameter(Mandatory=$true)][string]$FilePath,
  [Parameter(Mandatory=$true)][string]$ConfigPath
)

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
$PidFile = Join-Path $PSScriptRoot '..\data\excel-pivot.pid'
$PidDir = Split-Path $PidFile -Parent
if (-not (Test-Path $PidDir)) { New-Item -ItemType Directory -Path $PidDir -Force | Out-Null }

function Get-ExcelPids {
  @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}
function Release-ComObject($obj) {
  if ($null -ne $obj) {
    try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($obj) | Out-Null } catch {}
  }
}
function Get-StringArray($value) {
  if ($null -eq $value) { return @() }
  return @($value | ForEach-Object { [string]$_ })
}
function Set-PivotSelection($pivotTable, [string]$fieldName, $selectedValues) {
  $values = Get-StringArray $selectedValues
  if ($values.Count -eq 0) { return }
  $field = $null
  try {
    $field = $pivotTable.PivotFields($fieldName)
    try { $field.ClearAllFilters() } catch {}
    try { $field.EnableMultiplePageItems = $true } catch {}

    $items = $field.PivotItems()
    $wanted = @{}
    foreach ($v in $values) { $wanted[$v] = $true }
    $matching = 0
    for ($i=1; $i -le $items.Count; $i++) {
      $item = $null
      try { $item = $items.Item($i); if ($wanted.ContainsKey([string]$item.Name)) { $matching++ } }
      finally { Release-ComObject $item }
    }
    # Kaynakta seçili değerlerden hiçbiri yoksa alanı yanlışlıkla tamamen gizleme.
    if ($matching -eq 0) { Release-ComObject $items; return }
    # Önce hepsini görünür yap; Excel en az bir öğenin görünür kalmasını ister.
    for ($i=1; $i -le $items.Count; $i++) {
      $item = $null
      try { $item = $items.Item($i); $item.Visible = $true } catch {}
      finally { Release-ComObject $item }
    }
    for ($i=1; $i -le $items.Count; $i++) {
      $item = $null
      try {
        $item = $items.Item($i)
        if (-not $wanted.ContainsKey([string]$item.Name)) { $item.Visible = $false }
      } catch {}
      finally { Release-ComObject $item }
    }
    Release-ComObject $items
  } finally {
    Release-ComObject $field
  }
}
function Set-MonthOrder($pivotTable, [string]$fieldName) {
  $field = $null
  try {
    $field = $pivotTable.PivotFields($fieldName)
    try { $field.AutoSort(0, $field.Name) } catch {} # xlManual
    $months = @('Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık','Tarih Belirsiz')
    $pos = 1
    foreach ($m in $months) {
      $item = $null
      try { $item = $field.PivotItems($m); $item.Position = $pos; $pos++ } catch {}
      finally { Release-ComObject $item }
    }
  } finally { Release-ComObject $field }
}


function New-ExcelApplication {
  $attempts = [System.Collections.Generic.List[string]]::new()
  foreach ($progId in @('Excel.Application', 'Excel.Application.16', 'Excel.Application.15')) {
    try {
      $type = [Type]::GetTypeFromProgID($progId, $false)
      if ($null -ne $type) {
        $instance = [Activator]::CreateInstance($type)
        if ($null -ne $instance) { return $instance }
      }
      $attempts.Add("${progId}: ProgID bu PowerShell mimarisinde kayıtlı değil.")
    } catch {
      $attempts.Add("${progId}: $($_.Exception.Message)")
    }
  }
  throw ("Excel COM uygulaması oluşturulamadı. " + ($attempts -join ' | '))
}

function New-PivotCache($workbook, [string]$sourceAddress) {
  $lastError = $null
  # Farklı Excel sürümleri farklı sourceVersion değerlerini kabul eder.
  foreach ($version in @(6, 5, 4, 3)) {
    try { return $workbook.PivotCaches().Create(1, $sourceAddress, $version) }
    catch { $lastError = $_.Exception.Message }
  }
  try { return $workbook.PivotCaches().Create(1, $sourceAddress) }
  catch { throw "PivotCache oluşturulamadı: $lastError | $($_.Exception.Message)" }
}

if (Test-Path $PidFile) {
  $oldPid = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    try { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Milliseconds 400
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}
if (-not (Test-Path $FilePath)) { throw "Çalışma kitabı bulunamadı: $FilePath" }
if (-not (Test-Path $ConfigPath)) { throw "Pivot yapılandırması bulunamadı: $ConfigPath" }
$FilePath = (Resolve-Path $FilePath).Path
$ConfigPath = (Resolve-Path $ConfigPath).Path
$config = Get-Content -Raw -Encoding UTF8 $ConfigPath | ConvertFrom-Json

$excel = $null; $workbook = $null; $dataSheet = $null; $pivotSheet = $null
$pivotCache = $null; $pivotTable = $null; $sourceRange = $null; $sourceTable = $null
$ourExcelPid = $null
$stage = 'Baslatma'
try {
  $before = Get-ExcelPids
  $stage = 'Excel COM uygulamasini baslatma'
  $excel = New-ExcelApplication
  Start-Sleep -Milliseconds 400
  $after = Get-ExcelPids
  $newPids = @($after | Where-Object { $before -notcontains $_ })
  if ($newPids.Count -ge 1) { $ourExcelPid = $newPids[0]; Set-Content -Path $PidFile -Value $ourExcelPid -Force }

  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $stage = 'Calisma kitabini acma'
  $workbook = $excel.Workbooks.Open($FilePath, 0, $false)

  # Pivot sayfasi tarayici tarafinda onceden olusturulur. Burada sayfa silip yeniden
  # eklemiyoruz; bazı Excel/Office kurulumlarında Worksheets.Add COM cagrisı
  # 'Sheets sinifinin Add ozelligi alinamiyor' hatasi verebiliyor.
  $stage = 'Pivot ve PivotData sayfalarini acma'
  try { $pivotSheet = $workbook.Worksheets.Item('Pivot') }
  catch { throw "Pivot hazirlik sayfasi bulunamadi. Excel dosyasi Pivot sayfasi ile olusturulmamis." }
  try { $dataSheet = $workbook.Worksheets.Item('PivotData') }
  catch { throw "PivotData kaynak sayfasi bulunamadi." }

  try { $pivotSheet.Visible = -1 } catch {} # xlSheetVisible
  try { $pivotSheet.Cells.Clear() | Out-Null } catch { throw "Pivot sayfasi temizlenemedi: $($_.Exception.Message)" }
  $stage = 'PivotData araligini belirleme'
  $lastRow = $dataSheet.Cells($dataSheet.Rows.Count, 1).End(-4162).Row  # xlUp
  $lastCol = $dataSheet.Cells(1, $dataSheet.Columns.Count).End(-4159).Column # xlToLeft
  if ($lastRow -lt 2 -or $lastCol -lt 2) { throw 'PivotData sayfasında PivotTable oluşturacak veri bulunamadı.' }

  $sourceRange = $dataSheet.Range($dataSheet.Cells(1,1), $dataSheet.Cells($lastRow,$lastCol))
  # Kaynağı Excel tablosuna dönüştür. Alan listesi ve sonradan yenileme daha kararlı olur.
  for ($i=$dataSheet.ListObjects.Count; $i -ge 1; $i--) {
    $lo = $null
    try { $lo = $dataSheet.ListObjects.Item($i); $lo.Unlist() } catch {}
    finally { Release-ComObject $lo }
  }
  $stage = 'PivotData tablosunu olusturma'
  $sourceTable = $dataSheet.ListObjects.Add(1, $sourceRange, $null, 1) # xlSrcRange, xlYes
  $sourceTable.Name = 'BacklogPivotData'
  $sourceTable.TableStyle = 'TableStyleMedium2'

  $pivotSheet.Cells.Item(1,1).Value2 = 'Backlog Pivot'
  $pivotSheet.Cells.Item(1,1).Font.Bold = $true
  $pivotSheet.Cells.Item(1,1).Font.Size = 14
  $pivotSheet.Cells.Item(2,1).Value2 = 'Alanları değiştirmek için PivotTable içine tıklayın ve PivotTable Alanları panelini kullanın. +/- düğmeleriyle seviyeleri açıp kapatabilirsiniz.'
  $pivotSheet.Cells.Item(2,1).Font.Color = 0x666666

  $rowFields = Get-StringArray $config.rowFields
  $columnFields = Get-StringArray $config.columnFields
  $pageFields = Get-StringArray $config.pageFields
  $startRow = [Math]::Max(6, $pageFields.Count + 5)
  $sourceAddress = "'PivotData'!R1C1:R${lastRow}C${lastCol}"
  $stage = 'PivotCache olusturma'
  $pivotCache = New-PivotCache $workbook $sourceAddress
  try { $pivotCache.MissingItemsLimit = 0 } catch {}
  try { $pivotCache.RefreshOnFileOpen = $false } catch {}
  try { $pivotCache.EnableRefresh = $true } catch {}
  $stage = 'PivotTable olusturma'
  $pivotTable = $pivotCache.CreatePivotTable($pivotSheet.Cells($startRow,1), 'BacklogPivotTable')
  $pivotTable.ManualUpdate = $true

  $stage = 'Satir alanlarini yerlestirme'
  $position = 1
  foreach ($name in $rowFields) {
    $field = $null
    try { $field = $pivotTable.PivotFields($name); $field.Orientation = 1; $field.Position = $position; $position++ }
    finally { Release-ComObject $field }
  }
  $stage = 'Sutun alanlarini yerlestirme'
  $position = 1
  foreach ($name in $columnFields) {
    $field = $null
    try { $field = $pivotTable.PivotFields($name); $field.Orientation = 2; $field.Position = $position; $position++ }
    finally { Release-ComObject $field }
  }
  $stage = 'Filtre alanlarini yerlestirme'
  $position = 1
  foreach ($name in $pageFields) {
    if ($rowFields -contains $name -or $columnFields -contains $name) { continue }
    $field = $null
    try { $field = $pivotTable.PivotFields($name); $field.Orientation = 3; $field.Position = $position; $position++ }
    finally { Release-ComObject $field }
  }

  $stage = 'Deger alanlarini ekleme'
  $qtyField = $null; $orderField = $null; $qtyData = $null; $orderData = $null
  try {
    $qtyField = $pivotTable.PivotFields('Net Alım Sipariş Miktarı')
    $qtyData = $pivotTable.AddDataField($qtyField, 'Adet', -4157) # xlSum
    $qtyData.NumberFormat = '#,##0'
    $orderField = $pivotTable.PivotFields('Sipariş Sayacı')
    $orderData = $pivotTable.AddDataField($orderField, 'Sipariş Sayısı', -4157)
    $orderData.NumberFormat = '#,##0'
  } finally {
    Release-ComObject $qtyData; Release-ComObject $orderData
    Release-ComObject $qtyField; Release-ComObject $orderField
  }

  $stage = 'PivotTable yenileme ve bicimlendirme'
  $pivotTable.ManualUpdate = $false
  $pivotTable.RefreshTable() | Out-Null
  try { $pivotTable.RowAxisLayout(1) } catch {} # xlCompactRow
  try { $pivotTable.ShowDrillIndicators = $true } catch {}
  try { $pivotTable.EnableDrilldown = $true } catch {}
  try { $pivotTable.DisplayFieldCaptions = $true } catch {}
  try { $pivotTable.EnableFieldList = $true } catch {}
  try { $workbook.ShowPivotTableFieldList = $true } catch {}
  try { $pivotTable.PageFieldOrder = 2 } catch {}
  try { $pivotTable.PageFieldWrapCount = 3 } catch {}
  try { $pivotTable.ShowTableStyleRowStripes = $true } catch {}
  try { $pivotTable.ShowTableStyleColumnStripes = $false } catch {}
  try { $pivotTable.PreserveFormatting = $true } catch {}
  try { $pivotTable.HasAutoFormat = $true } catch {}
  try { $pivotTable.TableStyle2 = 'PivotStyleMedium2' } catch {}
  try { $pivotTable.NullString = '' } catch {}
  try { $pivotTable.DisplayNullString = $true } catch {}

  # Uygulamadaki aktif seçimleri gerçek Pivot filtrelerine uygula.
  if ($null -ne $config.filters) {
    foreach ($prop in $config.filters.PSObject.Properties) {
      Set-PivotSelection $pivotTable ([string]$prop.Name) $prop.Value
    }
  }
  if (($rowFields -contains 'Antrepo Ay') -or ($columnFields -contains 'Antrepo Ay') -or ($pageFields -contains 'Antrepo Ay')) {
    Set-MonthOrder $pivotTable 'Antrepo Ay'
  }
  $pivotTable.RefreshTable() | Out-Null

  # Pivot alanlarını ve kaynak veriyi koru; kaynak sayfa normal şekilde gizlenebilir.
  $stage = 'Kaynak sayfayi gizleme ve dosyayi kaydetme'
  $dataSheet.Visible = 0 # xlSheetHidden; kullanıcı isterse Excel'de gösterebilir
  $pivotSheet.Activate()
  $pivotSheet.Cells($startRow,1).Select() | Out-Null
  $pivotSheet.Columns.AutoFit() | Out-Null
  $workbook.Save()
  Write-Output "OK: İşlevsel Backlog PivotTable oluşturuldu. Satır=$($rowFields.Count), Sütun=$($columnFields.Count), Filtre=$($pageFields.Count)"
}
catch {
  $line = $_.InvocationInfo.ScriptLineNumber
  Write-Error ("PivotTable olusturma hatasi. Adim={0}; Satir={1}; Detay={2}" -f $stage, $line, $_.Exception.Message)
  exit 1
}
finally {
  if ($workbook) { try { $workbook.Close($false) } catch {} }
  if ($excel) { try { $excel.Quit() } catch {} }
  Release-ComObject $sourceTable; Release-ComObject $sourceRange
  Release-ComObject $pivotTable; Release-ComObject $pivotCache
  Release-ComObject $pivotSheet; Release-ComObject $dataSheet
  Release-ComObject $workbook; Release-ComObject $excel
  [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
  if ($ourExcelPid) {
    Start-Sleep -Milliseconds 800
    if (Get-Process -Id $ourExcelPid -ErrorAction SilentlyContinue) {
      try { Stop-Process -Id $ourExcelPid -Force -ErrorAction SilentlyContinue } catch {}
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
  }
}

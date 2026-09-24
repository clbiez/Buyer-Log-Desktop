# ModelQuery.ps1
# Excel'i hiç açmadan, ASAS/IAS veri modeline (SQL Server Analysis Services - Tabular)
# doğrudan bağlanıp bir DAX veya DMV sorgusu çalıştırır ve sonucu CSV/JSON olarak yazar.
#
# NEDEN VAR: Bugün "Kaynak Veriden Güncelle" akışı Excel'i görünmez şekilde açıp içindeki
# pivotu yeniliyor (bkz. RefreshExcel.ps1) ve bu adım dakikalar sürebiliyor. Model
# in-memory çalıştığı için aynı veri doğrudan sorgulandığında saniyeler içinde gelir.
# Bu script O ÖLÇÜMÜ ve O AKTARIMI yapar; mevcut Excel yenileme akışına DOKUNMAZ.
#
# Kullanım:
#   powershell -NoProfile -File ModelQuery.ps1 `
#     -Server lcwtabular_s30 -Catalog ASAS_30 -QueryFile C:\tmp\q.dax `
#     -OutFile C:\tmp\asas.csv -Format csv
#
# Çıktı: stdout'un SON satırı tek satırlık bir JSON özetidir (Node bu satırı okur):
#   {"ok":true,"provider":"ADOMD","rowCount":9812,"columnCount":14,"columns":[...],
#    "elapsedMs":734,"outFile":"...","bytes":1234567,"truncated":false}
#
# KİMLİK DOĞRULAMA: Analysis Services Windows kimliğiyle çalışır. Script hangi kullanıcı
# oturumunda çalışıyorsa modele o kullanıcının yetkisiyle bağlanır — Excel'de pivotu
# yenileyebiliyorsan burada da ek bir yetki istemene gerek yoktur. Modelde satır bazlı
# güvenlik (RLS) varsa sonuç Excel'dekiyle aynı kapsamda gelir.
#
# NOT: Bu script Windows dışında çalıştırılamaz ve bu depoda gerçek bir model üzerinde
# TEST EDİLMEMİŞTİR (RefreshExcel.ps1 ile aynı durum). İlk çalıştırmayı "Bağlantıyı
# Sına" düğmesiyle yapıp davranışını doğrula.

param(
  [Parameter(Mandatory=$true)][string]$Server,
  [Parameter(Mandatory=$true)][string]$Catalog,
  [string]$QueryFile = "",
  [string]$Query = "",
  [string]$OutFile = "",
  [ValidateSet("csv","json")][string]$Format = "csv",
  [int]$MaxRows = 500000,
  [int]$PreviewRows = 0,
  [string]$HeaderMapFile = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Konsol çıktısını UTF-8'e sabitle. Windows'ta PowerShell varsayılan olarak OEM kod
# sayfasıyla (cp857 vb.) yazar; Node stdout'u UTF-8 okuduğu için Türkçe karakterler
# bozuk görünüyordu ("sözdizimi" → "s??zdizimi"). Bu satır o bozulmayı engeller.
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch { }

function Write-Summary($obj) {
  # Node yalnız son satırı ayrıştırır; JSON'u tek satırda ve sıkıştırılmış yaz.
  Write-Output ($obj | ConvertTo-Json -Depth 5 -Compress)
}

# --- Sütun adı çevirisi ------------------------------------------------------
# SUMMARIZECOLUMNS grup sütunlarını "Tablo[Sütun]" adıyla döndürür. Uygulamanın
# beklediği başlıklara çevirmeyi DAX içinde yapmak kaçış karakteri sorunları
# yarattığı için çeviri burada, sonuç yazılırken uygulanır.
$script:headerMap = @{}
if ($HeaderMapFile -and (Test-Path $HeaderMapFile)) {
  try {
    $parsed = Get-Content -Path $HeaderMapFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $parsed.PSObject.Properties) { $script:headerMap[$property.Name] = [string]$property.Value }
  } catch { }
}
function Translate-Header($name) {
  $text = [string]$name
  if ($script:headerMap.ContainsKey($text)) { return $script:headerMap[$text] }
  # ADOMD bazı sürümlerde adı köşeli parantezle sarar: [Tablo[Sütun]]
  $trimmed = $text.Trim('[', ']')
  if ($script:headerMap.ContainsKey($trimmed)) { return $script:headerMap[$trimmed] }
  return $text
}

# --- Sorgu metni -------------------------------------------------------------
if ($QueryFile) {
  if (-not (Test-Path $QueryFile)) { throw "Sorgu dosyası bulunamadı: $QueryFile" }
  $Query = Get-Content -Path $QueryFile -Raw -Encoding UTF8
}
if (-not $Query -or -not $Query.Trim()) { throw "Sorgu boş." }
$Query = $Query.Trim()

# --- Bağlantı dizesi ---------------------------------------------------------
# Excel'in .odc dosyasındaki dizeyle birebir aynı sağlayıcı ve seçenekler kullanılır;
# böylece Excel'de çalışan bir model burada da aynı şekilde davranır.
$connectionString = "Provider=MSOLAP.8;Integrated Security=SSPI;Persist Security Info=True;Initial Catalog=$Catalog;Data Source=$Server;MDX Compatibility=1;Safety Options=2;MDX Missing Member Mode=Error;Update Isolation Level=2"

# --- ADOMD.NET yükleme denemesi ---------------------------------------------
# ADOMD.NET istemcisi kuruluysa en sağlam yol odur (tipler korunur, akış hızlıdır).
# Kurulu değilse Excel ile birlikte gelen MSOLAP OLE DB sağlayıcısı üzerinden ADODB'ye
# düşeriz — o da her makinede zaten mevcuttur, ek kurulum gerektirmez.
function Load-Adomd {
  try { Add-Type -AssemblyName "Microsoft.AnalysisServices.AdomdClient" -ErrorAction Stop; return $true } catch {}
  $roots = @(
    (Join-Path $env:ProgramFiles "Microsoft.NET\ADOMD.NET"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft.NET\ADOMD.NET")
  ) | Where-Object { $_ -and (Test-Path $_) }
  foreach ($root in $roots) {
    $dll = Get-ChildItem -Path $root -Filter "Microsoft.AnalysisServices.AdomdClient.dll" -Recurse -ErrorAction SilentlyContinue |
           Sort-Object FullName -Descending | Select-Object -First 1
    if ($dll) { try { Add-Type -Path $dll.FullName -ErrorAction Stop; return $true } catch {} }
  }
  return $false
}

# --- Yazıcılar ---------------------------------------------------------------
# CSV: Excel'in Türkçe yerel ayarında sorunsuz açılsın diye UTF-8 BOM + noktalı virgül.
# JSON: isteğe bağlıdır. Ana Refresh büyük sonuçlarda daha hızlı olan CSV yolunu kullanır.
$script:writer = $null
$script:rowsWritten = 0
$script:firstJsonRow = $true
$script:preview = New-Object System.Collections.ArrayList

function Open-Writer($path, $format) {
  $dir = Split-Path $path -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $encoding = if ($format -eq "csv") { New-Object System.Text.UTF8Encoding($true) } else { New-Object System.Text.UTF8Encoding($false) }
  $script:writer = New-Object System.IO.StreamWriter($path, $false, $encoding)
}

# SICAK DÖNGÜ — burada mikro optimizasyon önemlidir.
# Önceki sürüm her hücre için ForEach-Object ardışık düzeni kurup 4 ayrı regex
# -replace çalıştırıyordu. 150.000 satır x 28 sütun = 4,2 milyon hücrede bu, tek
# başına dakikalarca sürüyordu. Şimdi: ardışık düzen yok, regex yok, hücre başına
# fonksiyon çağrısı yok; tek bir StringBuilder yeniden kullanılıyor ve pahalı
# işlemler yalnız gerçekten gerektiğinde (IndexOf kontrolüyle) yapılıyor.
$script:sb = New-Object System.Text.StringBuilder 16384
$script:invariant = [System.Globalization.CultureInfo]::InvariantCulture

# Yalnız başlık satırı gibi seyrek yerlerde kullanılır; sıcak döngüde çağrılmaz.
function Csv-Cell($value) {
  if ($null -eq $value -or $value -is [System.DBNull]) { return "" }
  $text = if ($value -is [datetime]) { $value.ToString("yyyy-MM-dd") }
          elseif ($value -is [double] -or $value -is [decimal] -or $value -is [single]) { [string]::Format($script:invariant, "{0}", $value) }
          else { [string]$value }
  if ($text.IndexOf("`n") -ge 0 -or $text.IndexOf("`r") -ge 0) {
    $text = $text.Replace("`r`n", " ").Replace("`n", " ").Replace("`r", " ")
  }
  if ($text.IndexOf('"') -ge 0 -or $text.IndexOf(";") -ge 0) { return '"' + $text.Replace('"', '""') + '"' }
  return $text
}

function Json-Value($value) {
  if ($null -eq $value -or $value -is [System.DBNull]) { return "null" }
  if ($value -is [datetime]) { return '"' + $value.ToString("yyyy-MM-dd") + '"' }
  if ($value -is [bool]) { if ($value) { return "true" } else { return "false" } }
  if ($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal] -or $value -is [single]) {
    return [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0}", $value)
  }
  return (ConvertTo-Json ([string]$value) -Compress)
}

function Write-Header($columns, $format) {
  if ($format -eq "csv") {
    $script:writer.WriteLine((($columns | ForEach-Object { Csv-Cell $_ }) -join ";"))
  } else {
    $script:writer.Write("[")
  }
}

function Write-Row($columns, $values, $format) {
  if ($format -eq "csv") {
    # Hücre biçimlendirmesi bilerek satır içine yazıldı: PowerShell'de hücre başına
    # fonksiyon çağrısı bile milyonlarca hücrede ölçülebilir yük getiriyor.
    $sb = $script:sb
    [void]$sb.Clear()
    $count = $values.Length
    for ($c = 0; $c -lt $count; $c++) {
      if ($c -gt 0) { [void]$sb.Append(';') }
      $cell = $values[$c]
      if ($null -eq $cell -or $cell -is [System.DBNull]) { continue }
      if ($cell -is [string]) {
        $text = $cell
      } elseif ($cell -is [datetime]) {
        [void]$sb.Append($cell.ToString('yyyy-MM-dd')); continue
      } elseif ($cell -is [double] -or $cell -is [decimal] -or $cell -is [single] -or $cell -is [int] -or $cell -is [long]) {
        [void]$sb.Append([string]::Format($script:invariant, "{0}", $cell)); continue
      } else {
        $text = [string]$cell
      }
      if ($text.Length -eq 0) { continue }
      # Pahalı yollar yalnız gerçekten gerektiğinde: metinlerin büyük çoğunluğu
      # tırnak, noktalı virgül veya satır sonu içermez ve doğrudan eklenir.
      if ($text.IndexOf("`n") -ge 0 -or $text.IndexOf("`r") -ge 0) {
        $text = $text.Replace("`r`n", " ").Replace("`n", " ").Replace("`r", " ")
      }
      if ($text.IndexOf('"') -ge 0 -or $text.IndexOf(';') -ge 0) {
        [void]$sb.Append('"').Append($text.Replace('"', '""')).Append('"')
      } else {
        [void]$sb.Append($text)
      }
    }
    $script:writer.WriteLine($sb.ToString())
  } else {
    if (-not $script:firstJsonRow) { $script:writer.Write(",") }
    $script:firstJsonRow = $false
    $parts = @()
    for ($i = 0; $i -lt $columns.Count; $i++) {
      $parts += ((ConvertTo-Json ([string]$columns[$i]) -Compress) + ":" + (Json-Value $values[$i]))
    }
    $script:writer.Write("{" + ($parts -join ",") + "}")
  }
  $script:rowsWritten++
  if ($PreviewRows -gt 0 -and $script:preview.Count -lt $PreviewRows) {
    $row = @{}
    for ($i = 0; $i -lt $columns.Count; $i++) {
      $cell = $values[$i]
      $row[[string]$columns[$i]] = if ($null -eq $cell -or $cell -is [System.DBNull]) { $null }
                                   elseif ($cell -is [datetime]) { $cell.ToString("yyyy-MM-dd") }
                                   else { [string]$cell }
    }
    [void]$script:preview.Add($row)
  }
}

function Close-Writer($format) {
  if ($script:writer) {
    if ($format -eq "json") { $script:writer.Write("]") }
    $script:writer.Flush(); $script:writer.Dispose(); $script:writer = $null
  }
}

# --- Çalıştır ----------------------------------------------------------------
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$provider = ""
$script:msSetup = 0
$script:msConnectionOpen = 0
$script:msExecute = 0
$script:msWrite = 0
$script:msRetry = 0 # Bu katmanda otomatik retry yok; sıfır açıkça raporlanır.
$columns = @()
$truncated = $false
$target = if ($OutFile) { $OutFile } else { [System.IO.Path]::GetTempFileName() }

try {
  if (Load-Adomd) {
    $provider = "ADOMD"
    $connection = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection($connectionString)
    $script:msSetup = [int]$stopwatch.ElapsedMilliseconds
    $phaseWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $connection.Open()
    $script:msConnectionOpen = [int]$phaseWatch.ElapsedMilliseconds
    try {
      $command = $connection.CreateCommand()
      $command.CommandText = $Query
      $command.CommandTimeout = 0
      $phaseWatch.Restart()
      $reader = $command.ExecuteReader()
      # Yalnız ExecuteReader beklemesi gerçek sunucu sorgusu olarak ölçülür.
      $script:msExecute = [int]$phaseWatch.ElapsedMilliseconds
      $phaseWatch.Restart()
      try {
        $fieldCount = $reader.FieldCount
        for ($i = 0; $i -lt $fieldCount; $i++) { $columns += (Translate-Header $reader.GetName($i)) }
        Open-Writer $target $Format
        Write-Header $columns $Format
        while ($reader.Read()) {
          if ($script:rowsWritten -ge $MaxRows) { $truncated = $true; break }
          $values = New-Object object[] $fieldCount
          [void]$reader.GetValues($values)
          Write-Row $columns $values $Format
        }
      } finally { $reader.Close() }
      Close-Writer $Format
      $script:msWrite = [int]$phaseWatch.ElapsedMilliseconds
    } finally { $connection.Close() }
  }
  else {
    # ADOMD.NET yok → Excel ile gelen MSOLAP sağlayıcısı üzerinden ADODB.
    $provider = "ADODB"
    $connection = New-Object -ComObject ADODB.Connection
    $connection.CommandTimeout = 0
    $script:msSetup = [int]$stopwatch.ElapsedMilliseconds
    $phaseWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $connection.Open($connectionString)
    $script:msConnectionOpen = [int]$phaseWatch.ElapsedMilliseconds
    try {
      $phaseWatch.Restart()
      $recordset = $connection.Execute($Query)
      $script:msExecute = [int]$phaseWatch.ElapsedMilliseconds
      $phaseWatch.Restart()
      try {
        $fieldCount = $recordset.Fields.Count
        for ($i = 0; $i -lt $fieldCount; $i++) { $columns += (Translate-Header $recordset.Fields.Item($i).Name) }
        Open-Writer $target $Format
        Write-Header $columns $Format
        # GetRows toplu okur; satır satır MoveNext'e göre belirgin şekilde hızlıdır.
        while (-not $recordset.EOF) {
          $batch = $recordset.GetRows(2000)
          $batchRows = $batch.GetLength(1)
          for ($r = 0; $r -lt $batchRows; $r++) {
            if ($script:rowsWritten -ge $MaxRows) { $truncated = $true; break }
            $values = New-Object object[] $fieldCount
            for ($c = 0; $c -lt $fieldCount; $c++) { $values[$c] = $batch[$c, $r] }
            Write-Row $columns $values $Format
          }
          if ($truncated) { break }
        }
      } finally {
        try { $recordset.Close() } catch {}
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($recordset)
      }
      Close-Writer $Format
      $script:msWrite = [int]$phaseWatch.ElapsedMilliseconds
    } finally {
      try { $connection.Close() } catch {}
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($connection)
      [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
    }
  }

  Close-Writer $Format
  $stopwatch.Stop()
  $bytes = if (Test-Path $target) { (Get-Item $target).Length } else { 0 }
  $componentMs = $script:msSetup + $script:msConnectionOpen + $script:msExecute + $script:msWrite + $script:msRetry
  $cleanupMs = [int]([Math]::Max(0, $stopwatch.ElapsedMilliseconds - $componentMs))
  Write-Summary ([ordered]@{
    ok          = $true
    provider    = $provider
    server      = $Server
    catalog     = $Catalog
    rowCount    = $script:rowsWritten
    columnCount = $columns.Count
    columns     = @($columns)
    elapsedMs   = [int]$stopwatch.ElapsedMilliseconds
    setupMs     = [int]$script:msSetup
    connectionOpenMs = [int]$script:msConnectionOpen
    executeMs   = [int]$script:msExecute
    writeMs     = [int]$script:msWrite
    retryMs     = [int]$script:msRetry
    cleanupMs   = $cleanupMs
    overheadMs  = [int]($script:msSetup + $cleanupMs)
    outFile     = $target
    bytes       = $bytes
    truncated   = $truncated
    preview     = @($script:preview)
  })
}
catch {
  Close-Writer $Format
  $stopwatch.Stop()
  $message = $_.Exception.Message
  # Sık karşılaşılan hataları anlaşılır Türkçeye çevir; ham metin de korunur.
  $hint = ""
  if ($message -match "Cannot connect|bağlan|The connection either timed out") { $hint = "Sunucu adına veya ağ/VPN erişimine bak." }
  elseif ($message -match "Cannot find table|Cannot find column|not found|bulunamadı|does not exist") { $hint = "Bu ad modelde yok. 'Tabloları Listele' ile gerçek tablo adlarını getirip listeden seç." }
  elseif ($message -match "permission|denied|yetki") { $hint = "Windows hesabının bu model için okuma yetkisi yok görünüyor." }
  elseif ($message -match "Query \(|syntax|sözdizim") { $hint = "DAX sorgusunda sözdizimi hatası var." }
  Write-Summary ([ordered]@{
    ok        = $false
    provider  = $provider
    server    = $Server
    catalog   = $Catalog
    error     = $message
    hint      = $hint
    elapsedMs = [int]$stopwatch.ElapsedMilliseconds
    setupMs   = [int]$script:msSetup
    connectionOpenMs = [int]$script:msConnectionOpen
    executeMs = [int]$script:msExecute
    writeMs   = [int]$script:msWrite
    retryMs   = [int]$script:msRetry
  })
  exit 1
}

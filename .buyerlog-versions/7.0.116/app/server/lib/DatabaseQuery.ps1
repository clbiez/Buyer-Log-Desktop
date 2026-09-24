param(
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [string]$QueryPath = '',
  [int]$TimeoutSeconds = 30,
  [int]$MaxRows = 50,
  [switch]$TestOnly
)
$ErrorActionPreference = 'Stop'
$started = Get-Date
function Out-Result([hashtable]$value, [int]$exitCode=0) {
  $value.elapsedMs = [int](((Get-Date) - $started).TotalMilliseconds)
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 8))
  exit $exitCode
}
function Fail([string]$code, [string]$message) {
  Out-Result @{ ok=$false; code=$code; error=$message } 1
}
function Safe([object]$v) { if ($null -eq $v) { return '' }; return [string]$v }
function Braced([string]$v) { return '{' + (($v -replace '}', '}}')) + '}' }

try {
  $cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $kind = (Safe $cfg.kind).ToLowerInvariant()
  $server = Safe $cfg.server
  $database = Safe $cfg.database
  $dsn = Safe $cfg.dsn
  $provider = Safe $cfg.provider
  $driver = Safe $cfg.driver
  $port = 0
  try { $port = [int]$cfg.port } catch { $port = 0 }
  $authType = (Safe $cfg.authType).ToLowerInvariant()
  $username = if ($env:BUYERLOG_DB_USERNAME) { $env:BUYERLOG_DB_USERNAME } else { Safe $cfg.username }
  $password = if ($env:BUYERLOG_DB_PASSWORD) { $env:BUYERLOG_DB_PASSWORD } else { '' }
  $timeout = [Math]::Max(5, [Math]::Min(300, $TimeoutSeconds))
  $connection = $null

  if ($kind -eq 'sqlserver') {
    Add-Type -AssemblyName System.Data
    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $builder['Data Source'] = if ($port -gt 0) { "$server,$port" } else { $server }
    if ($database) { $builder['Initial Catalog'] = $database }
    $builder['Connect Timeout'] = $timeout
    if ($authType -eq 'windows') {
      $builder['Integrated Security'] = $true
    } else {
      if (-not $username -or -not $password) { Fail 'AUTH_REQUIRED' 'Bu bağlantı için kullanıcı adı ve parola gerekiyor.' }
      $builder['User ID'] = $username; $builder['Password'] = $password
    }
    if ($cfg.options) {
      if ($null -ne $cfg.options.encrypt -and (Safe $cfg.options.encrypt)) { try { $builder['Encrypt'] = [System.Convert]::ToBoolean($cfg.options.encrypt) } catch {} }
      if ($null -ne $cfg.options.trustServerCertificate -and (Safe $cfg.options.trustServerCertificate)) { try { $builder['TrustServerCertificate'] = [System.Convert]::ToBoolean($cfg.options.trustServerCertificate) } catch {} }
      if (Safe $cfg.options.applicationName) { $builder['Application Name'] = Safe $cfg.options.applicationName }
    }
    $connection = New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
  }
  elseif ($kind -eq 'odbc') {
    Add-Type -AssemblyName System.Data
    $parts = New-Object System.Collections.Generic.List[string]
    if ($dsn) { $parts.Add('DSN=' + (Braced $dsn)) }
    elseif ($driver) { $parts.Add('Driver=' + (Braced $driver)) }
    else { Fail 'DRIVER_NOT_FOUND' 'ODBC bağlantısı için DSN veya driver bilgisi yok.' }
    if ($server) { $serverValue = if ($port -gt 0) { "$server,$port" } else { $server }; $parts.Add('Server=' + (Braced $serverValue)) }
    if (Safe $cfg.serviceName) { $parts.Add('DBQ=' + (Braced (Safe $cfg.serviceName))) }
    elseif (Safe $cfg.sid) { $parts.Add('DBQ=' + (Braced (Safe $cfg.sid))) }
    if ($database) { $parts.Add('Database=' + (Braced $database)) }
    if ($authType -eq 'windows') { $parts.Add('Trusted_Connection=Yes') }
    elseif ($username -or $password) {
      if (-not $username -or -not $password) { Fail 'AUTH_REQUIRED' 'Bu bağlantı için kullanıcı adı ve parola gerekiyor.' }
      $parts.Add('UID=' + (Braced $username)); $parts.Add('PWD=' + (Braced $password))
    }
    $connection = New-Object System.Data.Odbc.OdbcConnection(($parts -join ';'))
  }
  elseif ($kind -eq 'oledb') {
    Add-Type -AssemblyName System.Data
    if (-not $provider) { Fail 'DRIVER_NOT_FOUND' 'OLE DB provider bilgisi bulunamadı.' }
    $parts = New-Object System.Collections.Generic.List[string]
    $parts.Add('Provider=' + $provider)
    if ($server) { $parts.Add('Data Source=' + $server) }
    elseif (Safe $cfg.serviceName) { $parts.Add('Data Source=' + (Safe $cfg.serviceName)) }
    elseif (Safe $cfg.sid) { $parts.Add('Data Source=' + (Safe $cfg.sid)) }
    if ($database) { $parts.Add('Initial Catalog=' + $database) }
    if ($authType -eq 'windows') { $parts.Add('Integrated Security=SSPI') }
    elseif ($username -or $password) {
      if (-not $username -or -not $password) { Fail 'AUTH_REQUIRED' 'Bu bağlantı için kullanıcı adı ve parola gerekiyor.' }
      $parts.Add('User ID=' + $username); $parts.Add('Password=' + $password)
    }
    $connection = New-Object System.Data.OleDb.OleDbConnection(($parts -join ';'))
  }
  else { Fail 'UNSUPPORTED_PROVIDER' 'Bu database provider Buyer Log tarafından doğrudan desteklenmiyor.' }

  try { $connection.Open() }
  catch {
    $msg = $_.Exception.Message
    if ($msg -match '(?i)(login failed|authentication|password|credential|ORA-01017|invalid user|access denied)') { Fail 'AUTH_FAILED' 'Database kimlik doğrulaması başarısız oldu.' }
    if ($msg -match '(?i)(data source name not found|driver.*not found|provider is not registered|class not registered|IM002)') { Fail 'DRIVER_NOT_FOUND' 'Bu bağlantının kullandığı database driver/provider bu bilgisayarda bulunamadı.' }
    if ($msg -match '(?i)(cannot open database|database .* does not exist|unknown database|ORA-12514|service.*not known)') { Fail 'DATABASE_NOT_FOUND' 'Database veya service bulunamadı.' }
    if ($msg -match '(?i)(server was not found|network-related|could not open a connection|timeout|timed out|host.*not found|ORA-12170|ORA-12541)') { Fail 'SERVER_UNREACHABLE' 'Database sunucusuna erişilemedi.' }
    Fail 'CONNECTION_FAILED' 'Database bağlantısı kurulamadı.'
  }

  if ($TestOnly) {
    $providerName = $connection.GetType().FullName
    try { $connection.Close() } catch {}
    Out-Result @{ ok=$true; provider=$providerName; state='Open' } 0
  }

  if (-not $QueryPath -or -not (Test-Path -LiteralPath $QueryPath)) { Fail 'QUERY_REQUIRED' 'Sorgu dosyası bulunamadı.' }
  $query = Get-Content -LiteralPath $QueryPath -Raw -Encoding UTF8
  if (-not $query.Trim()) { Fail 'QUERY_REQUIRED' 'Sorgu boş.' }
  if ($query -notmatch '(?is)^\s*(SELECT\b|WITH\b)') { Fail 'QUERY_NOT_ALLOWED' 'Yalnız SELECT/WITH ile başlayan salt-okunur SQL sorguları çalıştırılabilir.' }

  $command = $connection.CreateCommand()
  $command.CommandText = $query
  $command.CommandTimeout = $timeout
  $reader = $command.ExecuteReader()
  $rows = New-Object System.Collections.Generic.List[object]
  $count = 0
  while ($reader.Read() -and $count -lt [Math]::Max(1, $MaxRows)) {
    $row = [ordered]@{}
    for ($i=0; $i -lt $reader.FieldCount; $i++) {
      $name = $reader.GetName($i)
      $value = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
      if ($value -is [DateTime]) { $value = $value.ToString('o') }
      elseif ($value -is [byte[]]) { $value = '[binary]' }
      $row[$name] = $value
    }
    $rows.Add([pscustomobject]$row); $count++
  }
  try { $reader.Close() } catch {}; try { $connection.Close() } catch {}
  Out-Result @{ ok=$true; provider=$connection.GetType().FullName; rowCount=$rows.Count; rows=$rows; truncated=($count -ge [Math]::Max(1,$MaxRows)) } 0
}
catch {
  Fail 'DATABASE_CONNECTOR_FAILED' 'Database işlemi tamamlanamadı.'
}

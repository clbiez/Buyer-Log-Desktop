param(
  [Parameter(Mandatory=$true)][string]$Url,
  [int]$Port = 9223,
  [Parameter(Mandatory=$true)][string]$ProfileDir
)
$ErrorActionPreference = 'Stop'

function Get-EdgePath {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    ($(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe' })),
    ($(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe' })),
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  ) | Where-Object { $_ -and (Test-Path $_) }
  if (-not $candidates -or $candidates.Count -eq 0) { return $null }
  return $candidates[0]
}
function Test-Cdp {
  try {
    $version = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/version" -f $Port) -TimeoutSec 1
    return [bool]$version.webSocketDebuggerUrl
  } catch { return $false }
}
function Open-CdpTab {
  $encoded = [Uri]::EscapeDataString($Url)
  Invoke-RestMethod -Method Put -Uri ("http://127.0.0.1:{0}/json/new?{1}" -f $Port,$encoded) -TimeoutSec 3 | Out-Null
}
function Close-LegacyMalformedTabs {
  # v5.45-v5.57 start helper passed an unquoted --user-data-dir value to
  # Start-Process. If Buyer Log lived in a folder such as
  # "Buyer Log Beta - ChatGPT Agent", Edge interpreted the path words as URLs
  # (http://log/, http://beta/, http://-/, http://chatgpt/, http://agent/...).
  # Clean those old tabs only when the characteristic group is present, so an
  # unrelated intranet tab with one of these short hosts is never closed alone.
  try {
    $targets = @(Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/list" -f $Port) -TimeoutSec 2)
    $legacy = @()
    foreach ($target in $targets) {
      if (-not $target.id -or -not $target.url) { continue }
      $u = [string]$target.url
      if ($u -match '^http://(?:log|beta|chatgpt|-)/?$' -or $u -match '^http://agent/(?:server/data/agent-browser/managed-edge.*)?$') {
        $legacy += $target
      }
    }
    if ($legacy.Count -lt 3) { return }
    foreach ($target in $legacy) {
      try { Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/close/{1}" -f $Port,$target.id) -TimeoutSec 2 | Out-Null } catch {}
    }
  } catch {}
}
function Quote-NativeArgument([string]$Value) {
  # Windows PowerShell 5.1 joins Start-Process -ArgumentList items into one
  # command line. Arguments containing spaces therefore need their own native
  # quotes; otherwise Edge treats every path word as a separate startup URL.
  return '"' + ($Value -replace '"','\"') + '"'
}

try {
  if (Test-Cdp) {
    Close-LegacyMalformedTabs
    Open-CdpTab
    exit 0
  }

  $edge = Get-EdgePath
  if (-not $edge) { throw 'Microsoft Edge bulunamadı.' }
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
  $profileArg = '--user-data-dir=' + (Quote-NativeArgument $ProfileDir)
  $urlArg = Quote-NativeArgument $Url
  $args = @(
    "--remote-debugging-port=$Port",
    '--remote-debugging-address=127.0.0.1',
    $profileArg,
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeSidebarV2',
    '--disable-session-crashed-bubble',
    $urlArg
  )
  Start-Process -FilePath $edge -ArgumentList $args | Out-Null
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 200
    if (Test-Cdp) {
      Close-LegacyMalformedTabs
      exit 0
    }
  } while ((Get-Date) -lt $deadline)
  throw 'Buyer Log için yönetilen Edge otomasyon bağlantısı kurulamadı.'
} catch {
  # Buyer Log'un kendisini açmayı asla engelleme. Kurumsal Edge politikası remote
  # debugging'i kapatmışsa normal tarayıcıya düş. Browser Automation Connector bu
  # durumda bağlantı kurulamadığını Agent Workflow Studio içinde açıkça bildirir.
  try { Start-Process $Url | Out-Null } catch {}
  exit 2
}

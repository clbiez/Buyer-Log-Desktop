param()

$ErrorActionPreference = 'Stop'
$node = Join-Path $PSScriptRoot '..\..\node-portable\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { $node = $command.Source }
}
if (-not (Test-Path -LiteralPath $node)) {
  Write-Error 'Buyer Log durdurulamadı: Node.js bulunamadı.'
  exit 1
}

& $node (Join-Path $PSScriptRoot 'stop-buyer-log.js')
exit $LASTEXITCODE

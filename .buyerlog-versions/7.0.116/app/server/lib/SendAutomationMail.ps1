param([Parameter(Mandatory=$true)][string]$PayloadPath)
$ErrorActionPreference='Stop'
$p=Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
$outlook=New-Object -ComObject Outlook.Application
$mail=$outlook.CreateItem(0)
$mail.To=[string]$p.to
$mail.CC=[string]$p.cc
$mail.BCC=[string]$p.bcc
$mail.Subject=[string]$p.subject
$mail.HTMLBody=[string]$p.html
if($p.attachment -and (Test-Path -LiteralPath ([string]$p.attachment))){ [void]$mail.Attachments.Add([string]$p.attachment) }
$mail.Send()
Write-Output 'OK'

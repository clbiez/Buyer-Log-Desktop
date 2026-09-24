param(
  [Parameter(Mandatory=$true)][string]$Action,
  [Parameter(Mandatory=$false)][string]$PayloadPath,
  [Parameter(Mandatory=$false)][string]$OutputPath,
  [Parameter(Mandatory=$false)][string]$AttachmentPath
)

$ErrorActionPreference = 'Stop'

function Read-Payload {
  if (-not $PayloadPath -or -not (Test-Path -LiteralPath $PayloadPath)) { return [pscustomobject]@{} }
  $raw = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8
  if (-not $raw) { return [pscustomobject]@{} }
  return $raw | ConvertFrom-Json
}

function Write-Result([object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 8 -Compress
  if ($OutputPath) {
    [System.IO.File]::WriteAllText($OutputPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  } else {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $json
  }
}

function Get-OutlookApplication {
  try { return [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
  catch { return New-Object -ComObject Outlook.Application }
}

function Safe-String([object]$Value, [int]$Max = 200000) {
  if ($null -eq $Value) { return '' }
  $text = [string]$Value
  if ($text.Length -gt $Max) { return $text.Substring(0, $Max) }
  return $text
}

function Resolve-Item($Session, [string]$EncodedEntryId, [string]$EncodedStoreId) {
  $entryId = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedEntryId))
  $storeId = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedStoreId))
  if (-not $entryId) { return $null }
  if ($storeId) {
    try { return $Session.GetItemFromID($entryId, $storeId) } catch {}
  }
  try { return $Session.GetItemFromID($entryId) } catch {}
  # Some profiles return a StoreID alias that cannot later resolve the item.
  # Retry the EntryID against every currently mounted store before giving up.
  try {
    for ($i=1; $i -le $Session.Stores.Count; $i++) {
      $store = $Session.Stores.Item($i)
      try {
        $sid = Safe-String $store.StoreID 12000
        if ($sid) {
          try { return $Session.GetItemFromID($entryId, $sid) } catch {}
        }
      } finally { if ($store) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($store) } catch {} } }
    }
  } catch {}
  return $null
}

function Show-OutlookItemForeground($Item) {
  $inspector = $null
  try {
    $inspector = $Item.GetInspector()
    $Item.Display($false)
    Start-Sleep -Milliseconds 120
    try { $inspector.Activate() } catch {}
    try {
      $hwnd = [int64]$inspector.HWND
      if ($hwnd -ne 0) {
        if (-not ('BuyerLog.OutlookNative' -as [type])) {
          Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace BuyerLog {
  public static class OutlookNative {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  }
}
"@ -ErrorAction SilentlyContinue
        }
        if ('BuyerLog.OutlookNative' -as [type]) {
          [void][BuyerLog.OutlookNative]::ShowWindowAsync([IntPtr]$hwnd, 5)
          [void][BuyerLog.OutlookNative]::SetForegroundWindow([IntPtr]$hwnd)
        }
      }
    } catch {}
  } finally {
    if ($inspector) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($inspector) } catch {} }
  }
}

function Get-CleanPreview([string]$Body, [string]$HtmlBody = '', [int]$Max = 900) {
  $script:BLPreviewTableCount = 0
  $script:BLPreviewImageCount = 0
  $source = if ($HtmlBody) { [string]$HtmlBody } else { [string]$Body }
  if (-not $source) { return [pscustomobject]@{ text=''; tableCount=0; imageCount=0 } }

  if ($HtmlBody) {
    # Search previews stay compact: rich content is represented by deterministic
    # placeholders instead of flattening every table cell into the message text.
    $source = [regex]::Replace($source, '<!--[\s\S]*?-->', ' ')
    $source = [regex]::Replace($source, '<script\b[\s\S]*?<\/script\s*>', ' ', 'IgnoreCase')
    $source = [regex]::Replace($source, '<style\b[\s\S]*?<\/style\s*>', ' ', 'IgnoreCase')
    $source = [regex]::Replace($source, '<table\b[\s\S]*?<\/table\s*>', {
      param($m)
      $script:BLPreviewTableCount++
      return "`n`n#Tablo$($script:BLPreviewTableCount)`n`n"
    }, 'IgnoreCase')
    $source = [regex]::Replace($source, '<img\b[^>]*>', {
      param($m)
      $tag = [string]$m.Value
      $width = 0; $height = 0
      if ($tag -match '(?i)\bwidth\s*=\s*["'']?(\d+)') { [void][int]::TryParse($matches[1],[ref]$width) }
      if ($tag -match '(?i)\bheight\s*=\s*["'']?(\d+)') { [void][int]::TryParse($matches[1],[ref]$height) }
      if (($width -gt 0 -and $width -le 3) -or ($height -gt 0 -and $height -le 3) -or $tag -match '(?i)display\s*:\s*none|visibility\s*:\s*hidden|spacer|tracking|pixel|transparent|beacon') { return ' ' }
      $script:BLPreviewImageCount++
      return "`n`n#Görsel$($script:BLPreviewImageCount)`n`n"
    }, 'IgnoreCase')
    $source = $source -replace '(?i)<br\s*\/?\s*>', "`n"
    $source = $source -replace '(?i)<li\b[^>]*>', "`n• "
    $source = $source -replace '(?i)<\/li\s*>', "`n"
    $source = $source -replace '(?i)<\/?(p|div|h[1-6]|blockquote|section|article|header|footer|ul|ol)\b[^>]*>', "`n"
    $source = $source -replace '<[^>]+>', ' '
    try { $source = [System.Net.WebUtility]::HtmlDecode($source) } catch {}
  }

  $text = $source -replace "`r", ''
  $lines = $text -split "`n"
  $kept = New-Object System.Collections.Generic.List[string]
  $blank = $false
  foreach ($lineRaw in $lines) {
    $line = [string]$lineRaw
    if ($line -match '^\s*-{2,}\s*(Original Message|Forwarded Message|İletilen İleti|İletilmiş İleti)') { break }
    if ($line -match '^\s*(From|Kimden|Gönderen|Sent|Gönderildi|To|Kime|Cc|Subject|Konu)\s*:') { break }
    if ($line -match '^\s*(Kind Regards|Best Regards|Warm Regards|Regards|Thanks\s*(?:&|and)\s*Regards|Saygılarımla|Saygılar|İyi çalışmalar|Best Wishes)\b') { break }
    if ($line -match '^\s*(Please consider the environment before printing|Save paper!?|This e-?mail and any attachments|Bu e-?posta ve ekleri)\b') { break }
    $line = $line -replace '<mailto:[^>]+>', ' '
    $line = $line -replace 'mailto:\S+', ' '
    $line = $line -replace '<?[A-Z0-9._%+\-'']+@[A-Z0-9.\-]+\.[A-Z]{2,}>?', ' '
    $line = ($line -replace '[\t ]+', ' ').TrimEnd()
    if (-not $line.Trim()) {
      if ($kept.Count -gt 0 -and -not $blank) { $kept.Add(''); $blank = $true }
      continue
    }
    $kept.Add($line.TrimStart()); $blank = $false
  }
  $preview = ($kept -join "`n").Trim()
  if ($preview.Length -gt $Max) {
    $head = $preview.Substring(0,[Math]::Min($preview.Length,$Max+1))
    $cut = [Math]::Max($head.LastIndexOf("`n`n"), [Math]::Max($head.LastIndexOf('. '), [Math]::Max($head.LastIndexOf('! '),$head.LastIndexOf('? '))))
    if ($cut -lt [Math]::Floor($Max*0.6)) { $cut=$Max }
    $preview = $preview.Substring(0,[Math]::Min($cut,$preview.Length)).TrimEnd() + '…'
  }
  # Count only placeholders that survived signature/quoted-history trimming.
  $visibleTables = ([regex]::Matches($preview,'(?i)#Tablo\d+')).Count
  $visibleImages = ([regex]::Matches($preview,'(?i)#Görsel\d+')).Count
  return [pscustomobject]@{ text=$preview; tableCount=$visibleTables; imageCount=$visibleImages }
}

function Encode-Value([string]$Value) {
  if ($null -eq $Value) { $Value = '' }
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
}

function Get-InternetMessageId($Item) {
  try { return Safe-String ($Item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x1035001F')) 2000 }
  catch { return '' }
}

function Get-SearchDate($Item, [string]$Kind) {
  try {
    if ($Kind -eq 'SENT') { return [datetime]$Item.SentOn }
    return [datetime]$Item.ReceivedTime
  } catch {
    try { return [datetime]$Item.CreationTime } catch { return [datetime]::MinValue }
  }
}

function Search-Folder($Folder, [string]$Kind, [object[]]$Terms, [object[]]$ManualTerms, [datetime]$DateFrom, [datetime]$DateTo, [int]$MaxScan, [int]$MaxCandidates) {
  $out = New-Object System.Collections.Generic.List[object]
  if (-not $Folder) { return $out }
  $items = $Folder.Items
  $dateProperty = if ($Kind -eq 'SENT') { '[SentOn]' } else { '[ReceivedTime]' }
  try { $items.Sort($dateProperty, $true) } catch {}
  $scanned = 0
  for ($i = 1; $i -le $items.Count -and $scanned -lt $MaxScan -and $out.Count -lt $MaxCandidates; $i++) {
    $item = $null
    try {
      $item = $items.Item($i)
      if ($null -eq $item) { continue }
      if ([int]$item.Class -ne 43) { continue } # olMail
      $scanned++
      $when = Get-SearchDate $item $Kind
      if ($DateTo -ne [datetime]::MaxValue -and $when -gt $DateTo) { continue }
      if ($DateFrom -ne [datetime]::MinValue -and $when -lt $DateFrom) { break }

      $subject = Safe-String $item.Subject 4000
      $senderName = Safe-String $item.SenderName 1000
      $body = Safe-String $item.Body 160000
      $haystack = ($subject + "`n" + $senderName + "`n" + $body)
      # Sipariş/PLM/Model alanları kendi aralarında OR çalışır. Kullanıcının
      # manuel eklediği ifadeler ise ek daraltma kriteridir ve tamamı bulunmalıdır.
      $contextMatched = ($Terms.Count -eq 0)
      if (-not $contextMatched) {
        foreach ($term in $Terms) {
          if ([string]::IsNullOrWhiteSpace([string]$term)) { continue }
          if ($haystack.IndexOf([string]$term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $contextMatched = $true; break }
        }
      }
      if (-not $contextMatched) { continue }
      $manualMatched = $true
      foreach ($manualTerm in $ManualTerms) {
        if ([string]::IsNullOrWhiteSpace([string]$manualTerm)) { continue }
        if ($haystack.IndexOf([string]$manualTerm, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { $manualMatched = $false; break }
      }
      if (-not $manualMatched) { continue }

      $entryId = Safe-String $item.EntryID 12000
      $storeId = ''
      try { $storeId = Safe-String $Folder.StoreID 12000 } catch {}
      $conversationId = ''
      try { $conversationId = Safe-String $item.ConversationID 4000 } catch {}
      $attachments = 0
      try { $attachments = [int]$item.Attachments.Count } catch {}
      $unread = $false
      try { $unread = [bool]$item.UnRead } catch {}
      $importance = 'normal'
      try { if ([int]$item.Importance -eq 2) { $importance = 'high' } elseif ([int]$item.Importance -eq 0) { $importance = 'low' } } catch {}
      $htmlBody = ''
      try { $htmlBody = Safe-String $item.HTMLBody 300000 } catch {}
      $previewInfo = Get-CleanPreview $body $htmlBody 900
      $preview = [string]$previewInfo.text

      $out.Add([pscustomobject]@{
        entryId = (Encode-Value $entryId)
        storeId = (Encode-Value $storeId)
        internetMessageId = (Get-InternetMessageId $item)
        conversationId = $conversationId
        subject = $subject
        senderName = $senderName
        receivedDateTime = $when.ToUniversalTime().ToString('o')
        sentDateTime = $when.ToUniversalTime().ToString('o')
        bodyPreview = $preview
        tableCount = [int]$previewInfo.tableCount
        imageCount = [int]$previewInfo.imageCount
        hasAttachments = ($attachments -gt 0)
        attachmentCount = $attachments
        isRead = (-not $unread)
        importance = $importance
        folderName = (Safe-String $Folder.Name 500)
        folderKind = $Kind
      })
    } catch {
      # One malformed/protected item must not abort the whole mailbox scan.
    } finally {
      if ($item) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($item) } catch {} }
    }
  }
  return $out
}

try {
  $payload = Read-Payload

  if ($Action -eq 'Bridge') {
    $query = Safe-String $payload.query 2000
    if (-not $query) { throw 'Arama sorgusu boş.' }
    $mode = 'CLIPBOARD'
    try {
      $outlook = Get-OutlookApplication
      $session = $outlook.GetNamespace('MAPI')
      $explorer = $outlook.ActiveExplorer()
      if (-not $explorer) {
        $inbox = $session.GetDefaultFolder(6)
        $explorer = $inbox.GetExplorer()
        $explorer.Display()
      }
      # olSearchScopeAllOutlookItems = 2
      $explorer.Search($query, 2)
      $mode = 'INSTANT_SEARCH'
    } catch {
      try { Set-Clipboard -Value $query } catch {}
      try { Start-Process outlook.exe | Out-Null } catch {}
    }
    Write-Result ([pscustomobject]@{ ok=$true; mode=$mode; query=$query })
    exit 0
  }

  $outlook = Get-OutlookApplication
  $session = $outlook.GetNamespace('MAPI')

  if ($Action -eq 'Status') {
    $profileName = ''
    try { $profileName = Safe-String $session.CurrentUser.Name 500 } catch {}
    $storeName = ''
    try { $storeName = Safe-String ($session.GetDefaultFolder(6).Store.DisplayName) 500 } catch {}
    Write-Result ([pscustomobject]@{ ok=$true; available=$true; profileName=$profileName; storeName=$storeName; engine='CLASSIC_OUTLOOK_LOCAL' })
    exit 0
  }

  if ($Action -eq 'SearchOpen') {
    $internetNeedle = Safe-String $payload.internetMessageId 2000
    if (-not $internetNeedle) { throw 'InternetMessageId fallback bilgisi bulunamadı.' }
    $folders = @($session.GetDefaultFolder(6), $session.GetDefaultFolder(5))
    foreach ($folder in $folders) {
      if (-not $folder) { continue }
      $items = $folder.Items
      try { $items.Sort('[ReceivedTime]', $true) } catch { try { $items.Sort('[SentOn]', $true) } catch {} }
      $limit = [Math]::Min([int]$items.Count, 2500)
      for ($i=1; $i -le $limit; $i++) {
        $candidate = $null
        try {
          $candidate = $items.Item($i)
          if (-not $candidate -or [int]$candidate.Class -ne 43) { continue }
          $matched = $false
          if ($internetNeedle) {
            $iid = Get-InternetMessageId $candidate
            if ($iid -and $iid.Equals($internetNeedle,[System.StringComparison]::OrdinalIgnoreCase)) { $matched = $true }
          }
          if ($matched) {
            Show-OutlookItemForeground $candidate
            Write-Result ([pscustomobject]@{ ok=$true; opened=$true; method='INTERNET_MESSAGE_ID_FALLBACK' })
            exit 0
          }
        } catch {} finally { if ($candidate) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($candidate) } catch {} } }
      }
    }
    throw 'Outlook mesajı EntryID veya arama fallback ile bulunamadı.'
  }

  if ($Action -eq 'Search') {
    $terms = @()
    if ($payload.terms) { $terms = @($payload.terms | ForEach-Object { Safe-String $_ 500 } | Where-Object { $_ }) }
    $manualTerms = @()
    if ($payload.manualTerms) { $manualTerms = @($payload.manualTerms | ForEach-Object { Safe-String $_ 300 } | Where-Object { $_ }) }
    $dateFrom = [datetime]::MinValue
    $dateTo = [datetime]::MaxValue
    if ($payload.dateFrom) { try { $dateFrom = [datetime]::Parse([string]$payload.dateFrom).Date } catch {} }
    if ($payload.dateTo) { try { $dateTo = [datetime]::Parse([string]$payload.dateTo).Date.AddDays(1).AddTicks(-1) } catch {} }
    $maxScan = [Math]::Max(100, [Math]::Min(10000, [int]($payload.maxScan)))
    if ($maxScan -le 0) { $maxScan = 3500 }
    $maxCandidates = [Math]::Max(50, [Math]::Min(1000, [int]($payload.maxCandidates)))
    if ($maxCandidates -le 0) { $maxCandidates = 500 }

    $all = New-Object System.Collections.Generic.List[object]
    $inbox = $session.GetDefaultFolder(6)
    $sent = $session.GetDefaultFolder(5)
    foreach ($row in (Search-Folder $inbox 'INBOX' $terms $manualTerms $dateFrom $dateTo $maxScan $maxCandidates)) { $all.Add($row) }
    if ($all.Count -lt $maxCandidates) {
      foreach ($row in (Search-Folder $sent 'SENT' $terms $manualTerms $dateFrom $dateTo $maxScan ($maxCandidates-$all.Count))) { $all.Add($row) }
    }
    Write-Result ([pscustomobject]@{ ok=$true; available=$true; items=$all; scannedLimit=$maxScan; candidateLimit=$maxCandidates })
    exit 0
  }

  if ($Action -in @('Detail','Open','Attachment')) {
    $item = Resolve-Item $session (Safe-String $payload.entryId 20000) (Safe-String $payload.storeId 20000)
    if (-not $item) { throw 'Outlook mesajı bulunamadı.' }

    if ($Action -eq 'Open') {
      Show-OutlookItemForeground $item
      Write-Result ([pscustomobject]@{ ok=$true; opened=$true; foreground=$true })
      exit 0
    }

    if ($Action -eq 'Detail') {
      $html = ''
      try { $html = Safe-String $item.HTMLBody 500000 } catch {}
      $body = if ($html) { $html } else { Safe-String $item.Body 500000 }
      $attachments = New-Object System.Collections.Generic.List[object]
      try {
        for ($i=1; $i -le $item.Attachments.Count; $i++) {
          $a = $item.Attachments.Item($i)
          try {
            $contentId = ''
            try { $contentId = Safe-String ($a.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x3712001F')) 1000 } catch {}
            $attachments.Add([pscustomobject]@{ id=[string]$i; name=(Safe-String $a.FileName 1000); size=[int64]$a.Size; contentType='application/octet-stream'; attachmentType='file'; isInline=[bool]$contentId; contentId=$contentId })
          } finally { if ($a) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($a) } catch {} } }
        }
      } catch {}
      $contentType = if ($html) { 'html' } else { 'text' }
      Write-Result ([pscustomobject]@{ ok=$true; subject=(Safe-String $item.Subject 4000); contentType=$contentType; body=$body; attachments=$attachments })
      exit 0
    }

    if ($Action -eq 'Attachment') {
      $index = [int]$payload.attachmentId
      if ($index -lt 1 -or $index -gt $item.Attachments.Count) { throw 'Attachment bulunamadı.' }
      if (-not $AttachmentPath) { throw 'Attachment çıktı yolu eksik.' }
      $a = $item.Attachments.Item($index)
      try {
        $a.SaveAsFile($AttachmentPath)
        Write-Result ([pscustomobject]@{ ok=$true; name=(Safe-String $a.FileName 1000); size=[int64]$a.Size; contentType='application/octet-stream'; attachmentType='file' })
      } finally { if ($a) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($a) } catch {} } }
      exit 0
    }
  }

  throw "Bilinmeyen Outlook Local action: $Action"
} catch {
  $message = Safe-String $_.Exception.Message 3000
  Write-Result ([pscustomobject]@{ ok=$false; available=$false; error=$message; code='CLASSIC_OUTLOOK_LOCAL_FAILED' })
  exit 2
}

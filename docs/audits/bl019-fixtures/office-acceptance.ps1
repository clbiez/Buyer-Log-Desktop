param([Parameter(Mandatory=$true)][string]$FixtureRoot)
$ErrorActionPreference='Stop'
$report=[ordered]@{phases=@();limits=@();sent=$false}
$excel=$null;$book=$null;$sheet=$null
try {
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false;$excel.AskToUpdateLinks=$false;$excel.AutomationSecurity=3
 $book=$excel.Workbooks.Open((Join-Path $FixtureRoot 'collection-with-images.xlsx'),0,$true)
 $sheet=$book.Worksheets.Item(1)
 $values=$sheet.UsedRange.Value2;$models=0
 foreach($value in $values){if([string]$value -like 'BENCH-MODEL-*'){$models++}}
 if($models -ne 300 -or $sheet.Shapes.Count -ne 30){throw "Unexpected native Excel result: $models models, $($sheet.Shapes.Count) images"}
 $report.phases+=@{name='actual-excel-readonly-collection';version=$excel.Version;models=$models;images=$sheet.Shapes.Count;readOnly=$book.ReadOnly;milliseconds=$timer.Elapsed.TotalMilliseconds}
 $book.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet);$sheet=$null;[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book);$book=$null
 $book=$excel.Workbooks.Open((Join-Path $FixtureRoot 'cp-30030-current.xlsx'),0,$true)
 $sheet=$book.Worksheets.Item(1)
 $report.phases+=@{name='actual-excel-readonly-cp';usedRows=$sheet.UsedRange.Rows.Count;usedColumns=$sheet.UsedRange.Columns.Count;readOnly=$book.ReadOnly}
 if($sheet.UsedRange.Rows.Count -lt 30031){throw 'Native Excel CP workbook lost source rows'}
}catch{$report.excelError=$_.Exception.Message}finally{
 if($book){$book.Close($false)}
 if($sheet){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)}
 if($book){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book)}
 if($excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
}
$outlook=$null;$mail=$null;$read=$null;$namespace=$null
try{
 $outlook=New-Object -ComObject Outlook.Application
 $mail=$outlook.CreateItem(0)
 $mail.Subject='Buyer Log native acceptance - synthetic, no recipients'
 $mail.HTMLBody='<html><body><p>Buyer Log native acceptance</p><table><tr><td>BENCH-MODEL-0</td><td>13.75 USD</td></tr></table></body></html>'
 [void]$mail.Attachments.Add((Join-Path $FixtureRoot 'collection-with-images.xlsx'))
 if($mail.Recipients.Count -ne 0){throw 'Synthetic message unexpectedly contains recipients'}
 $messagePath=Join-Path $FixtureRoot 'buyer-log-native-acceptance.msg'
 $mail.SaveAs($messagePath,3)
 $mail.Close(1)
 $namespace=$outlook.GetNamespace('MAPI');$read=$namespace.OpenSharedItem($messagePath)
 if($read.Attachments.Count -ne 1 -or $read.Recipients.Count -ne 0 -or $read.HTMLBody -notlike '*BENCH-MODEL-0*'){throw 'Native Outlook message roundtrip mismatch'}
 $report.phases+=@{name='actual-outlook-local-msg-roundtrip';version=$outlook.Version;attachments=$read.Attachments.Count;recipients=$read.Recipients.Count;htmlContainsSyntheticModel=$true;sent=$false;mailboxSave=$false}
 $read.Close(1)
 if(Test-Path -LiteralPath (Join-Path $FixtureRoot 'buyer-log-product.eml')){
  try{$eml=$namespace.OpenSharedItem((Join-Path $FixtureRoot 'buyer-log-product.eml'));$report.phases+=@{name='actual-outlook-product-eml';subject=$eml.Subject;attachments=$eml.Attachments.Count;recipients=$eml.Recipients.Count};$eml.Close(1);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($eml)}catch{$report.limits+='Outlook COM cannot open the product EML directly: '+$_.Exception.Message}
 }
}catch{$report.outlookError=$_.Exception.Message}finally{
 foreach($object in @($read,$mail,$namespace,$outlook)){if($object){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object)}}
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'bl019-office-native.json') -Encoding utf8
$report | ConvertTo-Json -Depth 8
if($report.excelError -or $report.outlookError){exit 1}

'use strict';

/* ModelQuery.ps1 hızlı CSV yazıcısı (derlenmiş C#) — kaynak sözleşmesi.
   PowerShell bu ortamda çalıştırılamadığı için davranış metinden sabitlenir.
   Saha kabulü: kaynak doğrulama aracı 2026-11-18, ASAS 70,7 MB ve IAS 14 MB
   sonuç dosyaları iki yolda SHA-256 ile bayt bayt aynı (3 tur). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ps = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'ModelQuery.ps1'), 'utf8');

test('C# derlemesi başarısız olursa PowerShell döngüsü çalışır (iki sağlayıcı yolunda)', () => {
  assert.match(ps, /\$script:fastCsv = \$false\r?\ntry \{\r?\n\s+Add-Type -Language CSharp -ReferencedAssemblies System\.Data -ErrorAction Stop -TypeDefinition @'/);
  assert.match(ps, /\$script:fastCsv = \$true\r?\n\} catch \{/);
  const fastBranches = ps.match(/if \(\$script:fastCsv -and \$Format -eq "csv" -and \$PreviewRows -le 0\) \{/g) || [];
  assert.equal(fastBranches.length, 2, 'ADODB ve ADOMD yolları');
  // Eski hücre döngüsü her iki yolda else dalında aynen kalır.
  assert.equal((ps.match(/Write-Row \$columns \$values \$Format/g) || []).length, 2);
  assert.match(ps, /\[BLFastCsv\]::WriteBatch\(\$script:writer, \$batch, \$batchRows, \$fieldCount, \$remaining\)/);
  assert.match(ps, /\[BLFastCsv\]::WriteReader\(\$script:writer, \$reader, \$fieldCount, \$MaxRows - \$script:rowsWritten\)/);
});

test('C# biçimlendirmesi PowerShell Write-Row (csv) kurallarıyla aynıdır', () => {
  const cs = ps.slice(ps.indexOf('public static class BLFastCsv'), ps.indexOf("'@"));
  // PowerShell: DBNull/null → boş; datetime → yyyy-MM-dd; sayılar → InvariantCulture {0}
  assert.match(ps, /\$cell\.ToString\('yyyy-MM-dd'\)/);
  assert.match(cs, /\(\(DateTime\)cell\)\.ToString\("yyyy-MM-dd"\)/);
  assert.match(cs, /cell is double \|\| cell is decimal \|\| cell is float \|\| cell is int \|\| cell is long\) \{ sb\.Append\(string\.Format\(Inv, "\{0\}", cell\)\)/);
  assert.match(cs, /cell == null \|\| cell is DBNull\) return;/);
  // Satır sonu → boşluk; tırnak / noktalı virgül → tırnaklı ve "" kaçışı
  assert.match(cs, /Replace\("\\r\\n", " "\)\.Replace\("\\n", " "\)\.Replace\("\\r", " "\)/);
  assert.match(cs, /IndexOf\('"'\) >= 0 \|\| text\.IndexOf\(';'\) >= 0\) sb\.Append\('"'\)\.Append\(text\.Replace\("\\"", "\\"\\""\)\)\.Append\('"'\)/);
  assert.match(cs, /writer\.WriteLine\(sb\.ToString\(\)\)/);
  // PowerShell 5.1 Add-Type C# 5 derleyicisi: desen eşleme / string interpolation yok.
  assert.doesNotMatch(cs, /\bis \w+ \w+\)|\$"/);
});

test('özet hangi yazıcının kullanıldığını bildirir', () => {
  assert.equal((ps.match(/csvWriter\s+= \$\(if \(\$script:fastCsv\) \{ "csharp" \} else \{ "powershell" \}\)/g) || []).length, 2);
});

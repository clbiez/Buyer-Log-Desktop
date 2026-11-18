'use strict';

/*
 * AKTARIM DENEYİ — PowerShell hücre döngüsü ⇄ derlenmiş C# döngüsü
 *
 * BL'ın ModelQuery.ps1 dosyasına DOKUNULMAZ. Etkin çekirdekteki dosyanın bir
 * KOPYASI rapor klasörüne yazılır ve yalnız sonuç satırlarını CSV'ye dönüştüren
 * sıcak döngü, aynı biçimlendirme kurallarını uygulayan derlenmiş C# koduyla
 * değiştirilir. Sağlayıcı, bağlantı, sorgu, sütun adları, yazıcı ve özet aynen
 * kalır.
 *
 * Doğruluk: Her iki yolun ürettiği sonuç dosyası SHA-256 ile karşılaştırılır
 * (bayt bayt aynı olmalı). BL bu dosyayı okuduğu için aynı bayt = aynı veri.
 *
 * Çalıştırma, BL'ın kendi kancasıyla yapılır: modelQuery.runModelQuery
 * options.runner kabul eder ve queryConnectionRows queryOptions'ı oraya iletir.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CSHARP = String.raw`
using System;
using System.Data;
using System.Globalization;
using System.IO;
using System.Text;

public static class BLFastCsv
{
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // ModelQuery.ps1 Write-Row (csv) ile birebir aynı kurallar.
    public static void AppendCell(StringBuilder sb, object cell)
    {
        if (cell == null || cell is DBNull) return;
        string text;
        if (cell is string) text = (string)cell;
        else if (cell is DateTime) { sb.Append(((DateTime)cell).ToString("yyyy-MM-dd")); return; }
        else if (cell is double || cell is decimal || cell is float || cell is int || cell is long) { sb.Append(string.Format(Inv, "{0}", cell)); return; }
        else text = Convert.ToString(cell, Inv);
        if (text == null || text.Length == 0) return;
        if (text.IndexOf('\n') >= 0 || text.IndexOf('\r') >= 0) text = text.Replace("\r\n", " ").Replace("\n", " ").Replace("\r", " ");
        if (text.IndexOf('"') >= 0 || text.IndexOf(';') >= 0) sb.Append('"').Append(text.Replace("\"", "\"\"")).Append('"');
        else sb.Append(text);
    }

    // ADODB GetRows(...) dizisi: [alan, satır]. Yazılan satır sayısını döndürür.
    public static int WriteBatch(TextWriter writer, object[,] batch, int rows, int fields, int remaining)
    {
        StringBuilder sb = new StringBuilder(16384);
        int written = 0;
        for (int r = 0; r < rows; r++)
        {
            if (written >= remaining) break;
            sb.Length = 0;
            for (int c = 0; c < fields; c++) { if (c > 0) sb.Append(';'); AppendCell(sb, batch[c, r]); }
            writer.WriteLine(sb.ToString());
            written++;
        }
        return written;
    }

    public static bool Truncated;

    // ADOMD.NET okuyucusu (IDataReader).
    public static int WriteReader(TextWriter writer, IDataReader reader, int fields, int remaining)
    {
        Truncated = false;
        StringBuilder sb = new StringBuilder(16384);
        object[] values = new object[fields];
        int written = 0;
        while (reader.Read())
        {
            if (written >= remaining) { Truncated = true; break; }
            reader.GetValues(values);
            sb.Length = 0;
            for (int c = 0; c < fields; c++) { if (c > 0) sb.Append(';'); AppendCell(sb, values[c]); }
            writer.WriteLine(sb.ToString());
            written++;
        }
        return written;
    }
}
`;

const ADODB_LOOP = `          for ($r = 0; $r -lt $batchRows; $r++) {
            if ($script:rowsWritten -ge $MaxRows) { $truncated = $true; break }
            $values = New-Object object[] $fieldCount
            for ($c = 0; $c -lt $fieldCount; $c++) { $values[$c] = $batch[$c, $r] }
            Write-Row $columns $values $Format
          }`;
const ADODB_FAST = `          if ($Format -eq "csv" -and $PreviewRows -le 0) {
            $remaining = $MaxRows - $script:rowsWritten
            $written = [BLFastCsv]::WriteBatch($script:writer, $batch, $batchRows, $fieldCount, $remaining)
            $script:rowsWritten += $written
            if ($written -lt $batchRows) { $truncated = $true }
          } else {
${ADODB_LOOP.split('\n').map(line => `  ${line}`).join('\n')}
          }`;
const ADOMD_LOOP = `        while ($reader.Read()) {
          if ($script:rowsWritten -ge $MaxRows) { $truncated = $true; break }
          $values = New-Object object[] $fieldCount
          [void]$reader.GetValues($values)
          Write-Row $columns $values $Format
        }`;
const ADOMD_FAST = `        if ($Format -eq "csv" -and $PreviewRows -le 0) {
          $script:rowsWritten += [BLFastCsv]::WriteReader($script:writer, $reader, $fieldCount, $MaxRows - $script:rowsWritten)
          if ([BLFastCsv]::Truncated) { $truncated = $true }
        } else {
${ADOMD_LOOP.split('\n').map(line => `  ${line}`).join('\n')}
        }`;
const ANCHOR = '$ProgressPreference = "SilentlyContinue"';

/* Etkin çekirdeğin ModelQuery.ps1 kopyasını yamalar. Beklenen yapı yoksa
   (BL sürümü değişmişse) deney yapılmaz; yarım yama asla çalıştırılmaz. */
function buildPatchedScript(original) {
  const bom = original.charCodeAt(0) === 0xFEFF;
  const text = (bom ? original.slice(1) : original).replace(/\r\n/g, '\n');
  const problems = [];
  for (const [label, needle] of [['ADODB döngüsü', ADODB_LOOP], ['ADOMD döngüsü', ADOMD_LOOP], ['başlangıç', ANCHOR]]) {
    const count = text.split(needle).length - 1;
    if (count !== 1) problems.push(`${label} ${count} kez bulundu (1 bekleniyordu)`);
  }
  if (problems.length) return { ok: false, problems };
  const addType = `${ANCHOR}\n# --- Kaynak doğrulama aracı: aktarım deneyi (BL dosyası değil, kopya) ---\nAdd-Type -Language CSharp -ReferencedAssemblies System.Data -TypeDefinition @'\n${CSHARP.trim()}\n'@\n`;
  const patched = text.replace(ANCHOR, addType).replace(ADODB_LOOP, ADODB_FAST).replace(ADOMD_LOOP, ADOMD_FAST);
  return { ok: true, script: '﻿' + patched.replace(/\n/g, '\r\n') };
}

function sha256File(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch (_) { return ''; }
}

/* modelQuery.runModelQuery ile aynı runner sözleşmesi:
   (args, timeoutMs, {signal}) → {stdout, stderr, error}. Sonuç dosyası BL onu
   okuyup silmeden önce özetlenir. */
function createRunner(scriptPath, variant, record, deps = {}) {
  const exec = deps.execFile || execFile;
  return (args, timeoutMs, options = {}) => new Promise((resolve, reject) => {
    const queryFile = args[args.indexOf('-QueryFile') + 1];
    const outFile = args[args.indexOf('-OutFile') + 1];
    let queryHash = '';
    try { queryHash = crypto.createHash('sha256').update(fs.readFileSync(queryFile)).digest('hex').slice(0, 16); } catch (_) {}
    const started = Date.now();
    const child = exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(Object.assign(err, { stderr: String(stderr || '') }));
        let bytes = 0;
        try { bytes = fs.statSync(outFile).size; } catch (_) {}
        record({ variant, queryHash, sha256: sha256File(outFile), bytes, processMs: Date.now() - started });
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), error: err || null });
      });
    if (options.signal) options.signal.addEventListener('abort', () => { try { child.kill(); } catch (_) {} }, { once: true });
  });
}

/* Aynı turdaki temel ⇄ C# sonuç dosyalarını sorgu bazında eşleştirir. */
function compareHashes(records) {
  const byRound = new Map();
  for (const r of records) {
    const key = `${r.round}|${r.queryHash}`;
    if (!byRound.has(key)) byRound.set(key, {});
    byRound.get(key)[r.variant] = r;
  }
  const pairs = [...byRound.values()].filter(p => p.baseline && p.csharp);
  const mismatches = pairs.filter(p => p.baseline.sha256 !== p.csharp.sha256 || !p.baseline.sha256);
  return { pairs: pairs.length, mismatches };
}

module.exports = { CSHARP, buildPatchedScript, createRunner, compareHashes, ADODB_LOOP, ADOMD_LOOP };

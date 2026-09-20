@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "SELF=%~f0"
set "TMPPS=%TEMP%\BuyerLog_CodebaseMemory_V4_%RANDOM%_%RANDOM%.ps1"

title Buyer Log Desktop - Codebase Memory Full Export V4

echo.
echo ============================================================
echo  BUYER LOG DESKTOP - CODEBASE MEMORY FULL EXPORT V4
echo ============================================================
echo.
echo  Verified full export baslatiliyor.
echo  - Repo temiz snapshot ile yeniden indexlenecek
echo  - Full architecture ve tum node'lar alinacak
echo  - 19 relationship turu export edilecek
echo  - Buyuk edge turleri adaptif chunk'lara bolunecek
echo  - Beklenen / export edilen sayilar dogrulanacak
echo.
echo  Pencere kapanmadan islemin tamamlanmasini bekleyin.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$raw=[IO.File]::ReadAllText($env:SELF); $marker=[Environment]::NewLine+':__POWERSHELL__'+[Environment]::NewLine; $i=$raw.LastIndexOf($marker); if($i -lt 0){exit 2}; $ps=$raw.Substring($i+$marker.Length); [IO.File]::WriteAllText($env:TMPPS,$ps,(New-Object Text.UTF8Encoding($false)))"

if errorlevel 1 (
    echo.
    echo [HATA] Gecici PowerShell dosyasi olusturulamadi.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TMPPS%"
set "RC=%ERRORLEVEL%"

del /q "%TMPPS%" >nul 2>&1

echo.
if "%RC%"=="0" (
    echo ============================================================
    echo  V4 FULL / VERIFIED EXPORT TAMAMLANDI
    echo ============================================================
    echo.
    echo  Cikti klasoru:
    echo  C:\Users\clbiez\Desktop\BuyerLogDesktop-Codebase-Export
    echo.
    echo  Dosya:
    echo  BUYER_LOG_CODEBASE_MEMORY_FULL_V4.md
) else if "%RC%"=="2" (
    echo ============================================================
    echo  V4 EXPORT TAMAMLANDI ANCAK TAM DOGRULANAMADI
    echo ============================================================
    echo.
    echo  Olusan MD dosyasini ChatGPT'ye yukleyin.
    echo  Integrity Summary bolumu eksigi gosterecektir.
) else (
    echo ============================================================
    echo  ISLEM BASARISIZ - HATA KODU: %RC%
    echo ============================================================
)

echo.
pause
exit /b %RC%

:__POWERSHELL__
$ErrorActionPreference = "Stop"

$Repo       = "C:\Users\clbiez\Desktop\Buyer Log Desktop"
$Project    = "C-Users-clbiez-Desktop-Buyer-Log-Desktop"
$Desktop    = Split-Path -Parent $Repo
$ExportDir  = Join-Path $Desktop "BuyerLogDesktop-Codebase-Export"
$Output     = Join-Path $ExportDir "BUYER_LOG_CODEBASE_MEMORY_FULL_V4.md"
$StageDir   = Join-Path $ExportDir "_repo_export_staging"

$Utf8  = New-Object System.Text.UTF8Encoding($false)
$Fence = ([char]96).ToString() * 3
$NL    = [Environment]::NewLine

$LargeRelationshipTypes = @("USAGE","CALLS","DEFINES")
$AllRelationshipTypes = @(
    "USAGE",
    "CALLS",
    "DEFINES",
    "SIMILAR_TO",
    "IMPORTS",
    "WRITES",
    "HTTP_CALLS",
    "CONTAINS_FILE",
    "RAISES",
    "CONFIGURES",
    "CALL_REFERENCE",
    "THROWS",
    "DEFINES_METHOD",
    "HANDLES",
    "LISTENS_ON",
    "SEMANTICALLY_RELATED",
    "CONTAINS_FOLDER",
    "EMITS",
    "HAS_BRANCH"
)

$SourceLabels = @(
    "Function","Variable","Route","File","Module","Section","Method",
    "EnvVar","Class","Folder","Channel","Branch","Project"
)

$StagedFiles = @()
$Integrity = @()
$FatalMessage = $null

function Write-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, $Utf8)
}

function Append-Utf8([string]$Text) {
    [System.IO.File]::AppendAllText($Output, $Text, $Utf8)
}

function Add-Section {
    param(
        [Parameter(Mandatory=$true)][string]$Title,
        [AllowEmptyString()][string]$Content = "",
        [string]$Language = "text"
    )

    $Block = $NL + "## " + $Title + $NL + $NL +
             $Fence + $Language + $NL +
             $Content.TrimEnd() + $NL +
             $Fence + $NL

    Append-Utf8 $Block
}

function Invoke-CbmArgsFile {
    param(
        [Parameter(Mandatory=$true)][string]$Tool,
        [Parameter(Mandatory=$true)][hashtable]$Arguments
    )

    $ArgFile = Join-Path $env:TEMP ("cbm_v4_" + [Guid]::NewGuid().ToString("N") + ".json")

    try {
        $Json = $Arguments | ConvertTo-Json -Depth 60
        [System.IO.File]::WriteAllText($ArgFile, $Json, $Utf8)

        $Result = & codebase-memory-mcp cli $Tool --args-file $ArgFile
        $Rc = $LASTEXITCODE

        if ($Rc -ne 0) {
            throw "$Tool exited with code $Rc"
        }

        return (($Result | Out-String).Trim())
    }
    finally {
        Remove-Item -LiteralPath $ArgFile -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-CbmDirect {
    param([Parameter(Mandatory=$true)][string[]]$Arguments)

    $Result = & codebase-memory-mcp @Arguments
    $Rc = $LASTEXITCODE

    if ($Rc -ne 0) {
        throw "codebase-memory-mcp exited with code $Rc"
    }

    return (($Result | Out-String).Trim())
}

function Query-Graph {
    param(
        [Parameter(Mandatory=$true)][string]$Query,
        [int]$MaxRows = 100000
    )

    return Invoke-CbmArgsFile -Tool "query_graph" -Arguments @{
        project  = $Project
        max_rows = $MaxRows
        query    = $Query
    }
}

function Get-RowCount([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return 0 }

    $m = [regex]::Match($Text, '(?m)^rows:\s*(\d+)')
    if ($m.Success) {
        return [int64]$m.Groups[1].Value
    }

    $m2 = [regex]::Match($Text, '(?m)^total:\s*(\d+)')
    if ($m2.Success) {
        return [int64]$m2.Groups[1].Value
    }

    return 0
}

function Escape-CypherString([string]$Value) {
    if ($null -eq $Value) { return "" }
    return $Value.Replace("\", "\\").Replace('"', '\"')
}

function To-CypherStringList([string[]]$Values) {
    $parts = @()
    foreach ($v in $Values) {
        $parts += ('"' + (Escape-CypherString $v) + '"')
    }
    return "[" + ($parts -join ",") + "]"
}

function Invoke-FullIndex {
    try {
        return Invoke-CbmArgsFile -Tool "index_repository" -Arguments @{
            repo_path = $Repo
            mode      = "full"
        }
    }
    catch {
        Write-Host "      mode=full args-file basarisiz; direct CLI deneniyor..." -ForegroundColor Yellow
    }

    try {
        return Invoke-CbmDirect -Arguments @(
            "cli",
            "index_repository",
            "--repo-path", $Repo,
            "--mode", "full"
        )
    }
    catch {
        Write-Host "      direct --mode full kabul edilmedi; standart index deneniyor..." -ForegroundColor Yellow
    }

    return Invoke-CbmArgsFile -Tool "index_repository" -Arguments @{
        repo_path = $Repo
    }
}

function Stage-GeneratedRepoExports {
    New-Item -ItemType Directory -Force -Path $ExportDir | Out-Null
    New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

    $Candidates = Get-ChildItem -LiteralPath $Repo -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "BUYER_LOG_CODEBASE_MEMORY_FULL*.md" }

    foreach ($File in $Candidates) {
        $Dest = Join-Path $StageDir $File.Name

        if (Test-Path -LiteralPath $Dest) {
            Remove-Item -LiteralPath $Dest -Force
        }

        Move-Item -LiteralPath $File.FullName -Destination $Dest -Force

        $script:StagedFiles += [pscustomobject]@{
            Original = $File.FullName
            Staged   = $Dest
        }

        Write-Host "      Index disina gecici tasindi: $($File.Name)"
    }
}

function Restore-GeneratedRepoExports {
    foreach ($Item in $script:StagedFiles) {
        try {
            if (Test-Path -LiteralPath $Item.Staged) {
                Move-Item -LiteralPath $Item.Staged -Destination $Item.Original -Force
            }
        }
        catch {
            Write-Host "      UYARI: Eski export geri tasinamadi: $($Item.Original)" -ForegroundColor Yellow
        }
    }

    try {
        if (Test-Path -LiteralPath $StageDir) {
            Remove-Item -LiteralPath $StageDir -Force -Recurse -ErrorAction SilentlyContinue
        }
    }
    catch {}
}

function Get-RepoRelativeFilePaths {
    $ExcludedDirRegex = '\\(\.git|\.codex|\.claude|\.codebase-memory|\.agents)(\\|$)'

    $Files = Get-ChildItem -LiteralPath $Repo -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch $ExcludedDirRegex -and
            $_.Name -notlike "BUYER_LOG_CODEBASE_MEMORY_FULL*.md"
        }

    $Relative = foreach ($File in $Files) {
        $rel = $File.FullName.Substring($Repo.Length).TrimStart('\','/')
        $rel = $rel -replace '\\','/'
        $rel
    }

    return @($Relative | Sort-Object -Unique)
}

function Invoke-RelationshipQuery {
    param(
        [Parameter(Mandatory=$true)][string]$Type,
        [string]$WhereClause = "",
        [switch]$Simple
    )

    $WhereText = ""
    if (-not [string]::IsNullOrWhiteSpace($WhereClause)) {
        $WhereText = " WHERE " + $WhereClause
    }

    if (-not $Simple) {
        $Query = @"
MATCH (a)-[r:$Type]->(b)$WhereText
RETURN
    a.name AS source_name,
    a.qualified_name AS source_qualified_name,
    a.file_path AS source_file_path,
    properties(r) AS relationship_properties,
    b.name AS target_name,
    b.qualified_name AS target_qualified_name,
    b.file_path AS target_file_path
"@
    }
    else {
        $Query = @"
MATCH (a)-[r:$Type]->(b)$WhereText
RETURN
    a.name AS source_name,
    a.qualified_name AS source_qualified_name,
    a.file_path AS source_file_path,
    b.name AS target_name,
    b.qualified_name AS target_qualified_name,
    b.file_path AS target_file_path
"@
    }

    return Query-Graph -Query $Query
}

function Export-RelationshipSingle {
    param(
        [Parameter(Mandatory=$true)][string]$Type,
        [int64]$Expected
    )

    Write-Host "      -> $Type"

    $Mode = "WITH_PROPERTIES"
    $Errors = @()

    try {
        $Data = Invoke-RelationshipQuery -Type $Type
    }
    catch {
        $Errors += $_.Exception.Message
        $Mode = "SIMPLE_FALLBACK"

        try {
            $Data = Invoke-RelationshipQuery -Type $Type -Simple
        }
        catch {
            $Errors += $_.Exception.Message
            $Data = ""
            $Mode = "FAILED"
        }
    }

    $Count = Get-RowCount $Data

    if ($Mode -ne "FAILED") {
        Add-Section -Title ("Relationship: " + $Type) -Content $Data -Language "text"
    }
    else {
        Add-Section -Title ("Relationship: " + $Type + " - EXPORT WARNING") -Content ($Errors -join $NL) -Language "text"
    }

    $Status = if (($Mode -ne "FAILED") -and ($Count -eq $Expected)) { "COMPLETE" } else { "INCOMPLETE" }

    return [pscustomobject]@{
        Type       = $Type
        Expected   = $Expected
        Exported   = $Count
        Delta      = ($Expected - $Count)
        Status     = $Status
        Mode       = $Mode
        Chunks     = 1
        Failures   = $(if ($Mode -eq "FAILED") { 1 } else { 0 })
    }
}

function Export-LargeRelationshipBatch {
    param(
        [Parameter(Mandatory=$true)][string]$Type,
        [Parameter(Mandatory=$true)][string[]]$Paths,
        [Parameter(Mandatory=$true)][string]$ChunkName,
        [int]$Depth = 0
    )

    $Result = [ordered]@{
        Rows     = [int64]0
        Chunks   = 0
        Failures = 0
    }

    if ($Paths.Count -eq 0) {
        return [pscustomobject]$Result
    }

    $CypherList = To-CypherStringList $Paths
    $Where = "a.file_path IN $CypherList"

    try {
        $Data = Invoke-RelationshipQuery -Type $Type -WhereClause $Where
        $Rows = Get-RowCount $Data

        if ($Rows -gt 0) {
            Add-Section -Title ("Relationship: " + $Type + " / " + $ChunkName) -Content $Data -Language "text"
        }

        $Result.Rows = $Rows
        $Result.Chunks = 1
        return [pscustomobject]$Result
    }
    catch {
        if ($Paths.Count -gt 1) {
            $Mid = [Math]::Floor($Paths.Count / 2)

            $Left  = @($Paths[0..($Mid-1)])
            $Right = @($Paths[$Mid..($Paths.Count-1)])

            $A = Export-LargeRelationshipBatch -Type $Type -Paths $Left  -ChunkName ($ChunkName + "A") -Depth ($Depth + 1)
            $B = Export-LargeRelationshipBatch -Type $Type -Paths $Right -ChunkName ($ChunkName + "B") -Depth ($Depth + 1)

            $Result.Rows     = $A.Rows + $B.Rows
            $Result.Chunks   = $A.Chunks + $B.Chunks
            $Result.Failures = $A.Failures + $B.Failures
            return [pscustomobject]$Result
        }

        # One file still fails: split by source node label.
        $SinglePath = $Paths[0]
        Write-Host "         Tek dosya sorgusu buyuk/hata verdi; label bazinda bolunuyor: $SinglePath" -ForegroundColor Yellow

        $FileEsc = Escape-CypherString $SinglePath
        $AnyLabelSucceeded = $false

        foreach ($Label in $SourceLabels) {
            $WhereLabel = 'a.file_path = "' + $FileEsc + '" AND "' + $Label + '" IN labels(a)'

            try {
                $Data = Invoke-RelationshipQuery -Type $Type -WhereClause $WhereLabel
                $Rows = Get-RowCount $Data

                if ($Rows -gt 0) {
                    Add-Section -Title ("Relationship: " + $Type + " / " + $ChunkName + " / " + $Label) -Content $Data -Language "text"
                    $Result.Rows += $Rows
                    $AnyLabelSucceeded = $true
                }

                $Result.Chunks++
            }
            catch {
                # Final fallback for this file+label: simple source/target query.
                try {
                    $Data = Invoke-RelationshipQuery -Type $Type -WhereClause $WhereLabel -Simple
                    $Rows = Get-RowCount $Data

                    if ($Rows -gt 0) {
                        Add-Section -Title ("Relationship: " + $Type + " / " + $ChunkName + " / " + $Label + " SIMPLE") -Content $Data -Language "text"
                        $Result.Rows += $Rows
                        $AnyLabelSucceeded = $true
                    }

                    $Result.Chunks++
                }
                catch {
                    $Result.Failures++
                    $Result.Chunks++

                    $Warning = "File: $SinglePath" + $NL +
                               "Source label: $Label" + $NL +
                               "Error: " + $_.Exception.Message

                    Add-Section -Title ("Relationship: " + $Type + " / " + $ChunkName + " / " + $Label + " - EXPORT WARNING") -Content $Warning -Language "text"
                }
            }
        }

        if (-not $AnyLabelSucceeded -and $Result.Failures -eq 0) {
            $Result.Failures = 1
        }

        return [pscustomobject]$Result
    }
}

function Export-LargeRelationship {
    param(
        [Parameter(Mandatory=$true)][string]$Type,
        [int64]$Expected,
        [Parameter(Mandatory=$true)][string[]]$RepoPaths
    )

    Write-Host "      -> $Type (adaptive chunks)"

    $TotalRows = [int64]0
    $TotalChunks = 0
    $Failures = 0

    # Start with batches of 24 repository files.
    $BatchSize = 24

    for ($i = 0; $i -lt $RepoPaths.Count; $i += $BatchSize) {
        $End = [Math]::Min($i + $BatchSize - 1, $RepoPaths.Count - 1)
        $Batch = @($RepoPaths[$i..$End])
        $ChunkNo = [Math]::Floor($i / $BatchSize) + 1

        $Part = Export-LargeRelationshipBatch -Type $Type -Paths $Batch -ChunkName ("FILES_" + $ChunkNo)

        $TotalRows += $Part.Rows
        $TotalChunks += $Part.Chunks
        $Failures += $Part.Failures
    }

    # Capture edges whose source does not carry file_path.
    try {
        $NoFileData = Invoke-RelationshipQuery -Type $Type -WhereClause "a.file_path IS NULL"
        $NoFileRows = Get-RowCount $NoFileData

        if ($NoFileRows -gt 0) {
            Add-Section -Title ("Relationship: " + $Type + " / NO_FILE_PATH") -Content $NoFileData -Language "text"
            $TotalRows += $NoFileRows
        }

        $TotalChunks++
    }
    catch {
        try {
            $NoFileData = Invoke-RelationshipQuery -Type $Type -WhereClause "a.file_path IS NULL" -Simple
            $NoFileRows = Get-RowCount $NoFileData

            if ($NoFileRows -gt 0) {
                Add-Section -Title ("Relationship: " + $Type + " / NO_FILE_PATH SIMPLE") -Content $NoFileData -Language "text"
                $TotalRows += $NoFileRows
            }

            $TotalChunks++
        }
        catch {
            $Failures++
            $TotalChunks++
            Add-Section -Title ("Relationship: " + $Type + " / NO_FILE_PATH - EXPORT WARNING") -Content $_.Exception.Message -Language "text"
        }
    }

    $Status = if (($TotalRows -eq $Expected) -and ($Failures -eq 0)) { "COMPLETE" } else { "INCOMPLETE" }

    return [pscustomobject]@{
        Type       = $Type
        Expected   = $Expected
        Exported   = $TotalRows
        Delta      = ($Expected - $TotalRows)
        Status     = $Status
        Mode       = "ADAPTIVE_FILE_CHUNKS"
        Chunks     = $TotalChunks
        Failures   = $Failures
    }
}

function Build-IntegritySummary {
    param(
        [Parameter(Mandatory=$true)][object[]]$Rows,
        [int64]$ExpectedTotalEdges
    )

    $Lines = @()
    $Lines += "| Relationship | Expected | Exported | Delta | Status | Mode | Chunks | Failures |"
    $Lines += "|---|---:|---:|---:|---|---|---:|---:|"

    [int64]$ExportedTotal = 0

    foreach ($r in $Rows) {
        $ExportedTotal += [int64]$r.Exported
        $Lines += "| $($r.Type) | $($r.Expected) | $($r.Exported) | $($r.Delta) | $($r.Status) | $($r.Mode) | $($r.Chunks) | $($r.Failures) |"
    }

    $CompleteCount = @($Rows | Where-Object { $_.Status -eq "COMPLETE" }).Count
    $Verified = ($CompleteCount -eq $Rows.Count) -and ($ExportedTotal -eq $ExpectedTotalEdges)

    $Lines += ""
    $Lines += "**Relationship types complete:** $CompleteCount / $($Rows.Count)"
    $Lines += ""
    $Lines += "**Expected total edges:** $ExpectedTotalEdges"
    $Lines += ""
    $Lines += "**Exported total edges:** $ExportedTotal"
    $Lines += ""
    $Lines += "**Total edge delta:** $($ExpectedTotalEdges - $ExportedTotal)"
    $Lines += ""
    $Lines += $(if ($Verified) { "**FINAL STATUS: FULL / VERIFIED**" } else { "**FINAL STATUS: INCOMPLETE / REVIEW REQUIRED**" })

    return [pscustomobject]@{
        Text          = ($Lines -join $NL)
        Verified      = $Verified
        ExportedTotal = $ExportedTotal
        CompleteCount = $CompleteCount
    }
}

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

try {
    if (-not (Test-Path -LiteralPath $Repo -PathType Container)) {
        throw "Buyer Log klasoru bulunamadi: $Repo"
    }

    if ($null -eq (Get-Command codebase-memory-mcp -ErrorAction SilentlyContinue)) {
        throw "codebase-memory-mcp PATH icinde bulunamadi."
    }

    New-Item -ItemType Directory -Force -Path $ExportDir | Out-Null

    Write-Host ""
    Write-Host "[1/12] Eski generated map dosyalari index disina gecici aliniyor..."
    Stage-GeneratedRepoExports

    Write-Host "[2/12] Codebase Memory surumu kontrol ediliyor..."
    try {
        $Version = ((& codebase-memory-mcp --version 2>&1 | Out-String).Trim())
    }
    catch {
        $Version = "Version bilgisi alinamadi."
    }

    Write-Host "[3/12] Buyer Log FULL index guncelleniyor..."
    $IndexResult = Invoke-FullIndex

    Write-Host "[4/12] Proje listesi aliniyor..."
    $Projects = Invoke-CbmDirect -Arguments @("cli","list_projects")

    Write-Host "[5/12] Graph schema aliniyor..."
    $Schema = Invoke-CbmArgsFile -Tool "get_graph_schema" -Arguments @{
        project = $Project
    }

    try {
        $SchemaObject = $Schema | ConvertFrom-Json
    }
    catch {
        throw "Graph schema JSON parse edilemedi. V4 sayisal dogrulama yapamaz."
    }

    $ExpectedEdges = [int64](($SchemaObject.edge_types | Measure-Object -Property count -Sum).Sum)

    $ExpectedByType = @{}
    foreach ($Edge in $SchemaObject.edge_types) {
        $ExpectedByType[[string]$Edge.type] = [int64]$Edge.count
    }

    Write-Host "[6/12] Full architecture + file tree aliniyor..."
    $Architecture = Invoke-CbmArgsFile -Tool "get_architecture" -Arguments @{
        project = $Project
        aspects = @("all")
    }

    Write-Host "[7/12] Circular CALLS cycles aliniyor..."
    try {
        $Cycles = Invoke-CbmArgsFile -Tool "get_architecture" -Arguments @{
            project = $Project
            aspects = @("cycles")
        }
    }
    catch {
        $Cycles = "cycles export failed: " + $_.Exception.Message
    }

    Write-Host "[8/12] Graph node / relationship sayilari aliniyor..."
    $NodeCounts = Query-Graph -Query "MATCH (n) RETURN labels(n) AS labels, count(*) AS count ORDER BY count DESC"
    $RelationshipCounts = Query-Graph -Query "MATCH ()-[r]->() RETURN type(r) AS relationship, count(*) AS count ORDER BY count DESC"

    Write-Host "[9/12] Tum graph node'lari export ediliyor..."
    $AllNodes = Query-Graph -Query "MATCH (n) RETURN n"

    Write-Host "[10/12] Repo source file listesi hazirlaniyor..."
    $RepoPaths = Get-RepoRelativeFilePaths
    Write-Host "       Dosya adaylari: $($RepoPaths.Count)"

    $Generated = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"

    $Header = @"
# Buyer Log Desktop - Codebase Memory Full Context V4

> Auto-generated structural context for ChatGPT.
>
> Repository: $Repo
> Codebase Memory project: $Project
> Generated: $Generated
> Codebase Memory: $Version
> Export format: V4
> Export location: outside repository
>
> V4 is designed as a numerically verified full graph export.
> Generated Codebase Memory snapshot files are temporarily removed from the
> repository before re-indexing so they do not contaminate the graph.
>
> Source code remains authoritative if this snapshot and the repository disagree.

## Instructions for ChatGPT

Use this document as the primary structural map for Buyer Log Desktop.

Prefer the actual file paths, symbols, architecture, dependency relationships,
CALLS relationships, clusters, hotspots, routes, layers and graph data in this
document over guesses.

The final `Integrity Summary` compares every exported relationship type against
the edge counts reported by Codebase Memory's graph schema.

When source code is also supplied, source code is the final authority.

"@

    Write-Utf8 -Path $Output -Text $Header

    Add-Section -Title "Full Index Result" -Content $IndexResult -Language "text"
    Add-Section -Title "Codebase Memory Projects" -Content $Projects -Language "text"
    Add-Section -Title "Graph Schema" -Content $Schema -Language "json"
    Add-Section -Title "Full Architecture - all aspects including file tree" -Content $Architecture -Language "text"
    Add-Section -Title "Circular CALLS Dependencies - cycles" -Content $Cycles -Language "text"
    Add-Section -Title "Node Counts" -Content $NodeCounts -Language "text"
    Add-Section -Title "Relationship Counts" -Content $RelationshipCounts -Language "text"
    Add-Section -Title "All Graph Nodes" -Content $AllNodes -Language "text"

    Write-Host "[11/12] 19 relationship turu export ediliyor..."
    Write-Host ""

    foreach ($Type in $AllRelationshipTypes) {
        if (-not $ExpectedByType.ContainsKey($Type)) {
            $Integrity += [pscustomobject]@{
                Type       = $Type
                Expected   = 0
                Exported   = 0
                Delta      = 0
                Status     = "NOT_IN_SCHEMA"
                Mode       = "SKIPPED"
                Chunks     = 0
                Failures   = 0
            }
            continue
        }

        $Expected = [int64]$ExpectedByType[$Type]

        if ($LargeRelationshipTypes -contains $Type) {
            $Result = Export-LargeRelationship -Type $Type -Expected $Expected -RepoPaths $RepoPaths
        }
        else {
            $Result = Export-RelationshipSingle -Type $Type -Expected $Expected
        }

        $Integrity += $Result
    }

    Write-Host ""
    Write-Host "[12/12] Integrity verification yapiliyor..."

    $Summary = Build-IntegritySummary -Rows $Integrity -ExpectedTotalEdges $ExpectedEdges

    Append-Utf8 ($NL + "## Integrity Summary" + $NL + $NL + $Summary.Text + $NL)

    $Footer = @"

---

## V4 Export Notes

- The output file is written outside the Buyer Log repository.
- Existing generated `BUYER_LOG_CODEBASE_MEMORY_FULL*.md` files are temporarily
  moved out of the repository before the full re-index and restored afterwards.
- Full architecture is requested with aspects=["all"].
- Circular CALLS analysis is requested separately with aspects=["cycles"].
- All graph nodes are exported.
- Smaller relationship types are exported in one query per type.
- USAGE, CALLS and DEFINES are exported with adaptive file-path chunking.
- Failed large chunks are recursively split until individual files are reached.
- A failing single-file chunk is split again by source node label.
- Relationship properties are preserved whenever supported.
- Every relationship type is compared with the count from `get_graph_schema`.
- FULL / VERIFIED is emitted only when all 19 relationship counts match and the
  sum of exported edges equals the schema's total edge count.
- Absence from Codebase Memory does not prove absence from source code.

"@

    Append-Utf8 $Footer

    if (-not (Test-Path -LiteralPath $Output -PathType Leaf)) {
        throw "V4 Markdown dosyasi olusturulamadi."
    }

    $Item = Get-Item -LiteralPath $Output
    $SizeMB = [Math]::Round($Item.Length / 1MB, 2)

    Write-Host ""
    Write-Host "============================================================"

    if ($Summary.Verified) {
        Write-Host " V4 FULL / VERIFIED" -ForegroundColor Green
    }
    else {
        Write-Host " V4 INCOMPLETE / REVIEW REQUIRED" -ForegroundColor Yellow
    }

    Write-Host "============================================================"
    Write-Host ""
    Write-Host "Dosya              : $Output"
    Write-Host "Boyut              : $SizeMB MB"
    Write-Host "Relationship types : $($Summary.CompleteCount) / $($Integrity.Count)"
    Write-Host "Expected edges      : $ExpectedEdges"
    Write-Host "Exported edges      : $($Summary.ExportedTotal)"
    Write-Host ""

    try {
        Start-Process explorer.exe -ArgumentList "/select,`"$Output`""
    }
    catch {}

    if (-not $Summary.Verified) {
        $script:FinalExitCode = 2
    }
    else {
        $script:FinalExitCode = 0
    }
}
catch {
    $FatalMessage = $_.Exception.Message
    $script:FinalExitCode = 1
}
finally {
    Write-Host ""
    Write-Host "Eski generated map dosyalari repository'e geri tasiniyor..."
    Restore-GeneratedRepoExports
}

if ($FatalMessage) {
    Write-Host ""
    Write-Host "[HATA] $FatalMessage" -ForegroundColor Red
}

exit $script:FinalExitCode

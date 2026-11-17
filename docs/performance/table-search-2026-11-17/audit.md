# Shared table search — scope and audit

Risk P2; local search correctness and a new LCW period criterion. No persisted business data, synchronization, pricing calculations or release channels changed.

## Implementation

`public/table-search-core.js` owns folding, parsing, labels, text/period matching and row-group grammar. `app-main.js` keeps the existing global helper names and `BLTableSearch` API. Feedback and row groups consume this parser; clipboard formatting stays in `table-search-row-groups.js`. `tableSearchSpace` still returns string haystacks and the same fields/valueOf contract.

Period values are separate from text: EX/RE/MB map through canonical bindings for `exFactory`, `retailDate`, `inStore`, `inStoreMonth`, and the newly registered `inStoreWeek`. Order activity has its own canonical `orderActivity` field, separate from operational `orderStatus`. The server registry already imports the browser registry, so it needs no duplicate mapping.

Both text and period caches use current value signatures and weak row keys. Display aliases are language independent and bounded. Period computation is lazy; a missing Merch Calendar never uses ISO/GLB or Gregorian month. Replacing/clearing the calendar changes a generation number and invalidates period caches. Repeated dates share a bounded generation-specific cache. Collection MB prefers stored month/week codes, then the date. Week 53 is accepted by the week-code reader.

Feedback evaluates each positive item in the scope left after all filters except search. Invalid criteria have a separate TR/EN heading. Negative-only items are not reported as missing. Collection scope scanning skips sorting/group projection because feedback only needs physical rows.

## MB JULY observation

Source: Collection `inStoreMonth`, displayed by `kolMonthDisplay` using `KOL_MONTHS_TR`/`KOL_MONTHS_EN`; column label Model Budget Month. The raw `TEMMUZ 2027` displays `JULY 2027` in English. The isolated real-app runtime uses model `DEMO SUMMER`, which contains no JULY token. Searching JULY finds this row solely through its month display alias. The two real PNGs in `public/release-notes/next-assets/table-search-*.png` were inspected and show the post-change result with synthetic data.

## Read-only audit outside this PR's editing scope

| Location | Finding |
| --- | --- |
| `public/pricing-desk.js:1078–1079` | History search uses `toLocaleLowerCase('tr-TR')` on query and text. FATİH/fatih match, but FATIH becomes fatıh and does not match fatih. This is a Turkish-fold parity issue, rather than default lowercase's combining-dot bug. Its `foldName` helper near 816 already maps Turkish letters for a different path. No direct changes. |
| `public/license-atlas.js` | No equivalent free-text search haystack found. The lowercase call near 42 checks the imported filename's `.html` extension. No search fix needed in this file; no direct changes. |
| `public/lfl.js:153–156`, `public/lfl-calculation-engine.js:4` | Main search runs `countryKey`: Turkish uppercase plus explicit letter mapping before its later ASCII lowercase. FATİH/fatih/FATIH agree; no equivalent combining-dot bug verified on this path. The ASAS column chooser uses Turkish uppercase without full accent folding and is not the main table search. No direct changes. |
| `public/collection-spreadsheet.js:98,115` | Default lowercase remains in pasted-header detection. SİPARİŞ becomes `si\u0307pari\u0307ş`, so a differently cased Turkish header can evade detection. This is clipboard/header recognition, not a table-search query. No direct changes. |
| `public/automations.js:271,325,371` | Field validation and report-column search use Turkish locale lowercase. FATIH/fatih can diverge through dotless ı, and TRIKO/TRİKO differ. No direct changes. |
| `public/app-main.js` column-filter builders near 6900/7450 | `disp.toLowerCase()` still creates a combining dot before storing `data-txt`. These boxes already call the shared matcher; the new shared fold removes that mark. No dedicated column-filter edits were made. Collection header filter `renderList(query)` already uses the shared parser/matcher on original values. |

Node reproduction: default lowercase FATİH != fatih; Turkish-locale lowercase FATİH != FATIH; default lowercase SİPARİŞ != sipariş. The scope above was audited, not silently expanded.

## Product decision retained

Contains mode still matches W7 inside a Special Code such as W7AK… . That is an intentional existing product behavior. Tests also prove a row whose Season is W7 matches without any W7 value in Special Code.

## Validation interpretation

Functional acceptance uses a real isolated Buyer Log server and Chromium, synthetic accounts/data only, TR and EN, CP/Orders/Collection, missing/invalid feedback, non-search filters and period OR. The calendar fixture deliberately maps 2027-04-26 (ISO week 17, Gregorian April) to LCW week 22 and merch month 5.

The performance script records 30,000 synthetic Orders and Collection rows, cold filtering, five warm filters and every typed prefix for plain `MINEC` and `MB=M5; MINEC`. Three alternating main/candidate pairs run in fresh browser contexts. Main is pinned to `844dcb27`. Native main does not support period syntax and returns zero rows for that query; candidate returns 30. A separate main reference applies its existing MINEC search followed by an explicit equivalent LCW/Collection month predicate, and verifies 30 rows. Raw native and reference samples are retained rather than implying equal period semantics on native main.

No TEST or STABLE workflow is triggered. PR creation and CI checking are separate from merge and publication.

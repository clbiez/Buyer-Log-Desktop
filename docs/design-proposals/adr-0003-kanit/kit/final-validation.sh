#!/bin/bash
# Birleşik main NİHAİ doğrulaması — Linux + Electron yarısı (tek komut). Windows yarısı iş akışlarıyla (aşağıda).
#
# Kullanım:
#   REPO=<repo kökü> BASE=d43150b CAND=<birleşik main SHA> EL=<electron 44.3.0 dist/electron> OUT=<çıktı> \
#   [SOAK_MIN=110] [ROWS=30000] ./final-validation.sh [adımlar...]
# Adımlar (varsayılan: test gate shadow l2 soak). CPU yoğun adımlar ARDIŞIK koşar; koşu sırasında başka ölçüm yok.
#   test   : CAND tam `npm test` (Linux, Node — Node 22 sonucu üretimi temsil etmez, regresyon kapısıdır)
#   gate   : .github/electron-gate/gate.js Electron'da, --strict-known (G08b dahil bilinen bulgular FAIL sayılır),
#            G10 = sıfırdan tam kuruluma karşı veri eşliği, G13 = 15 dk soak
#   shadow : kit shadow4.js — bağımsız gölge: Supp. FOB/not/Del. Type/Ex-factory sonrası sıfırdan tam kurulum eşliği
#   l2     : kit run-t0-electron-2app.sh — Electron L2 aynı-t0, BASE (A, A/A) ↔ CAND (B), 9 kol dönüşümlü
#   soak   : kit soak.js — Electron bellek dayanıklılığı SOAK_MIN dk (§6Q yöntemi) + analyze-soak.js
# Windows yarısı (ebeveyn/ürün sahibi tetikler, ref = CAND):
#   - "Buyer Log Tests" (buyerlog-tests.yml) workflow_dispatch ref=CAND  → tam regresyon (Windows, TEMP=runner.temp)
#   - "Buyer Log Windows Electron gate" workflow_dispatch ref=CAND strict_known=true → gerçek BuyerLog.exe kapısı
set -euo pipefail
: "${REPO:?}" "${BASE:?}" "${CAND:?}" "${EL:?}" "${OUT:?}"
SOAK_MIN=${SOAK_MIN:-110}; ROWS=${ROWS:-30000}
KIT=$(cd "$(dirname "$0")" && pwd)
STEPS=${*:-test gate shadow l2 soak}
mkdir -p "$OUT"; W="$OUT/wt"; mkdir -p "$W"
BASEOPT="--use-openssl-ca --max-old-space-size=3686"
VER=$(ELECTRON_RUN_AS_NODE=1 "$EL" -e 'process.stdout.write(process.versions.electron+" node "+process.versions.node)')
for pair in "base:$BASE" "cand:$CAND"; do n=${pair%%:*}; sha=${pair#*:}
  if [ ! -d "$W/$n" ]; then git -C "$REPO" fetch -q origin "$sha" 2>/dev/null || true; git -C "$REPO" worktree add -q --detach "$W/$n" "$sha"; (cd "$W/$n/resources/app" && npm ci --ignore-scripts --silent); fi
done
APP_A="$W/base/resources/app"; APP_B="$W/cand/resources/app"
{ echo "base $(git -C "$W/base" rev-parse HEAD)"; echo "cand $(git -C "$W/cand" rev-parse HEAD)"; echo "electron $VER"; echo "node $(node -v)"; echo "os $(uname -sr) $(nproc) vCPU"; echo "NODE_OPTIONS(ölçüm)=$BASEOPT"; date -u +%FT%TZ; } > "$OUT/ortam.txt"
SRC="$OUT/src$ROWS"; [ -f "$SRC/ASAS - Demo.xlsx" ] || node "$APP_B/scripts/generate-demo-data.js" "$SRC" --rows "$ROWS" --seed 7 > /dev/null
declare -A RES; declare -A T0; declare -A T1
# Çekişme göstergesi (PSI cpu/io/memory + steal) tüm koşu boyunca; önce 60 sn boşta taban. Kendi yükü de PSI'ya girer:
# karar adım penceresi ile boşta taban birlikte okunur (contention.js summary).
node "$KIT/contention.js" record "$OUT/contention.jsonl" 5000 & CPID=$!; trap 'kill $CPID 2>/dev/null' EXIT
IDLE0=$(date -u +%FT%TZ); sleep 60; IDLE1=$(date -u +%FT%TZ)
for s in $STEPS; do T0[$s]=$(date -u +%FT%TZ); echo "[final] $s başlıyor $(date -u +%T)"; case $s in
  test)   (cd "$APP_B" && BUYER_LOG_TEST_SLOWEST=40 npm test > "$OUT/test.log" 2>&1) && RES[test]=PASS || RES[test]=FAIL ;;
  gate)   (cd "$APP_B" && env -u BUYER_LOG_CP_ROWPATCH_LEGACY -u BUYER_LOG_COMPUTE_GC_RECHECK ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="--use-openssl-ca" \
             "$EL" "$W/cand/.github/electron-gate/gate.js" --app "$APP_B" --fixture-app "$APP_B" --out "$OUT/gate" --rows "$ROWS" --soak-min 15 --heap-mb 3686 --strict-known > "$OUT/gate.log" 2>&1) && RES[gate]=PASS || RES[gate]=FAIL ;;
  shadow) (cd "$APP_B" && env -u BUYER_LOG_CP_ROWPATCH_LEGACY ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="$BASEOPT" "$EL" "$KIT/shadow4.js" "$APP_B" "$SRC" "$OUT/shadow.json" off > "$OUT/shadow.log" 2>&1) || true
          node -e "const r=require(process.argv[1]),c=r.checks||{};const ok=!r.errors.length&&!Object.keys(c.v2_v3_all||{}).length&&!Object.keys(c.v1_v3_phase1||{}).length&&c.t2_t3_allRows===0&&c.t1_t3_allRows_exceptLater===0;console.log(ok?'PASS':'FAIL');process.exit(ok?0:1)" "$OUT/shadow.json" > "$OUT/shadow.verdict" && RES[shadow]=PASS || RES[shadow]=FAIL ;;
  l2)     KIT="$KIT" SRC="$SRC" OUT="$OUT/l2" APP_A="$APP_A" APP_B="$APP_B" EL="$EL" BASEOPT="$BASEOPT" bash "$KIT/run-t0-electron-2app.sh" && RES[l2]="bkz. l2/t0-ozet.txt (karar: önceden yazılı bütçe)" || RES[l2]=FAIL ;;
  soak)   (cd "$APP_B" && env -u BUYER_LOG_CP_ROWPATCH_LEGACY -u BUYER_LOG_COMPUTE_GC_RECHECK ELECTRON_RUN_AS_NODE=1 HOOK_LOG="$OUT/soak.hook" \
             NODE_OPTIONS="$BASEOPT --require=$KIT/hook-soak.js" SOAK_MIN="$SOAK_MIN" SOAK_GAP_MS=15000 SOAK_CHECK_MIN=10 "$EL" "$KIT/soak.js" "$APP_B" "$SRC" "$OUT/soak.json" > "$OUT/soak.log" 2>&1) || true
          mkdir -p "$OUT/soak-analiz"; node "$KIT/analyze-soak.js" "$OUT/soak.json" "$OUT/soak.hook" "$OUT/soak-analiz" > "$OUT/soak-analiz/ozet.txt" 2>&1 || true
          node -e "const r=require(process.argv[1]);const ch=r.checks||[];const ok=!r.errors.length&&ch.length>0&&ch.every(c=>c.equal&&c.values&&c.values.badCount===0)&&r.baseline&&r.baseline.equalToFinal&&r.edits.every(e=>e.save.status===200&&(e.cp.n503||0)===0&&(e.orders.n503||0)===0);console.log(ok?'PASS':'FAIL');process.exit(ok?0:1)" "$OUT/soak.json" > "$OUT/soak.verdict" && RES[soak]=PASS || RES[soak]=FAIL ;;
  *) echo "bilinmeyen adım $s"; exit 2;;
esac; T1[$s]=$(date -u +%FT%TZ); echo "[final] $s → ${RES[$s]} $(date -u +%T)"; done
kill $CPID 2>/dev/null; sleep 1
cs() { node "$KIT/contention.js" summary "$OUT/contention.jsonl" "$1" "$2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const f=k=>o[k]?o[k].med+'/'+o[k].p90:'-';console.log('cpuSome '+f('cpuSome')+' · ioSome '+f('ioSome')+' · steal '+f('stealPct')+' · '+o.verdict)})"; }
{ echo "| Adım | Sonuç | Çekişme (PSI med/p90 %, steal %) |"; echo "|---|---|---|"; echo "| (boşta taban 60 sn) | — | $(cs "$IDLE0" "$IDLE1") |"
  for s in $STEPS; do echo "| $s | ${RES[$s]} | $(cs "${T0[$s]}" "${T1[$s]}") |"; done; } > "$OUT/ozet.md"; cat "$OUT/ortam.txt" "$OUT/ozet.md"

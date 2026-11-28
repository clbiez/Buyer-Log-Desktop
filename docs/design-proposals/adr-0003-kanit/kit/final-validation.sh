#!/bin/bash
# Birleşik main NİHAİ doğrulaması — Linux + Electron yarısı (tek komut). Windows yarısı iş akışlarıyla (aşağıda).
#
# Kullanım:
#   REPO=<repo kökü> BASE=<STABLE 8.0.18 kaynak commit'i, 12521fc> CAND=<birleşik main SHA> EL=<electron 44.3.0 dist/electron> \
#   OUT=<çıktı, OS geçici dizini DIŞINDA> [SOAK_MIN=110] [SOAK_BASE_MIN=30] [ROWS=30000] [BLOCKS=3] [MAX_REPEAT=1] ./final-validation.sh [adımlar...]
# Kollar: base = 8.0.18, comb = CAND, aa = CAND tekrarı (A/A gürültü bandı). Tüm kollar: Electron ELECTRON_RUN_AS_NODE=1,
#   NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686", aynı fixture (CAND üreteci, 30k seed 7, her 4. ASAS satırında
#   yükleme onayı boş → düzenlenebilir Ex-factory; Windows kapısıyla aynı dönüşüm, fixture-ex.js).
# Adımlar (varsayılan: test gate shadow shadowbase hub perf soak soakbase). CPU yoğun adımlar ARDIŞIK; koşu sırasında başka ölçüm yok.
#   test       : CAND tam `npm test` (Linux, Node — regresyon kapısı; Node sonucu üretim çalışma zamanını temsil etmez)
#   gate       : .github/electron-gate/gate.js Electron'da --strict-known (G08 ailesi iki oturum/bayat yazım, G09 yeniden başlatma,
#                G10 tam kurulum eşliği, G13 15 dk soak)
#   shadow     : kit shadow5.js CAND — artımlı ↔ yeniden başlatma ↔ sıfırdan tam kurulum eşitliği (Supp. FOB, not, toplu,
#                POST /rows, Del. Type, Ex-factory, Kaynağa dön, Eksik Adet, IAS parsiyelli, kıtlık, çoklu renk, geri al)
#   shadowbase : aynı betik BASE'de (bilgi: bilinen hata 8.0.18'de var/yok; eksik uç nokta/niyet durum koduyla)
#   hub        : kit hub.js CAND — iki gerçek sunucu + ortak Shared Hub yakınsaması
#   perf       : BLOCKS dönüşümlü blok × {base, comb, aa}: perf3.js (açılış, kendi kayıt → CP/Siparişler hazır, CPU, 503) +
#                fresh2.js (diğer istemcide Del. Type aşama tablosu); analyze-perf3.js
#   soak       : CAND soak.js SOAK_MIN dk (§6Q/6T yöntemi) + analyze-soak.js
#   soakbase   : BASE soak.js SOAK_BASE_MIN dk (aynı iş yükü, kısa karşılaştırma)
#   l2         : (isteğe bağlı) eski aynı-t0 ab8 9 kol — run-t0-electron-2app.sh
# Çekişme: contention.js tüm koşu boyunca; her adım penceresi SAKİN değilse adım en fazla MAX_REPEAT kez yeniden koşar
# (önceki deneme <adım>.denemeN olarak saklanır). PSI ölçülen işin kendi yükünü de içerir: boşta taban ile birlikte okunur.
# Windows yarısı (ebeveyn/ürün sahibi tetikler, ref = CAND):
#   - "Buyer Log Tests" (buyerlog-tests.yml) workflow_dispatch ref=CAND  → tam regresyon (Windows, TEMP=runner.temp)
#   - "Buyer Log Windows Electron gate" workflow_dispatch ref=CAND strict_known=true → gerçek BuyerLog.exe kapısı
set -euo pipefail
: "${REPO:?}" "${BASE:?}" "${CAND:?}" "${EL:?}" "${OUT:?}"
SOAK_MIN=${SOAK_MIN:-110}; SOAK_BASE_MIN=${SOAK_BASE_MIN:-30}; ROWS=${ROWS:-30000}; BLOCKS=${BLOCKS:-3}; MAX_REPEAT=${MAX_REPEAT:-1}
KIT=$(cd "$(dirname "$0")" && pwd)
STEPS=${*:-test gate shadow shadowbase hub perf soak soakbase}
# Worktree'ler OS geçici dizininin altında OLMAMALI: tests/user-data-temp-root-recovery.test.js çalışma alanı yolunun
# geçici kökün dışında olduğunu varsayar; /tmp altındaki worktree'de bu test (ürün hatası olmadan) düşer (2026-11-28).
TMPROOT=$(node -p "require('fs').realpathSync(require('os').tmpdir())"); mkdir -p "$OUT"; OUTREAL=$(cd "$OUT" && pwd -P)
case "$OUTREAL/" in "$TMPROOT"/*) echo "OUT ($OUTREAL) OS geçici dizini ($TMPROOT) altında olamaz; ör. OUT=\$HOME/final-validation" >&2; exit 2;; esac
W="$OUT/wt"; mkdir -p "$W"
BASEOPT="--use-openssl-ca --max-old-space-size=3686"
VER=$(ELECTRON_RUN_AS_NODE=1 "$EL" -e 'process.stdout.write(process.versions.electron+" node "+process.versions.node)')
for pair in "base:$BASE" "cand:$CAND"; do n=${pair%%:*}; sha=${pair#*:}
  if [ ! -d "$W/$n" ]; then git -C "$REPO" fetch -q origin "$sha" 2>/dev/null || true; git -C "$REPO" worktree add -q --detach "$W/$n" "$sha"; (cd "$W/$n/resources/app" && npm ci --ignore-scripts --silent); fi
done
APP_A="$W/base/resources/app"; APP_B="$W/cand/resources/app"
# Kapı betikleri: varsayılan CAND ağacındaki; GATE_JS ile başka (ör. main'e yeni alınmış kapı) betiği verilebilir — uygulama ağacı yine CAND.
GATE_JS=${GATE_JS:-$W/cand/.github/electron-gate/gate.js}
{ echo "base $(git -C "$W/base" rev-parse HEAD) (package.json $(node -p "require('$APP_A/package.json').version"))"
  echo "cand $(git -C "$W/cand" rev-parse HEAD) (package.json $(node -p "require('$APP_B/package.json').version"))"
  echo "electron $VER (ELECTRON_RUN_AS_NODE=1)"; echo "host node $(node -v) (yalnız test adımı ve analiz)"; echo "os $(uname -sr) $(nproc) vCPU $(awk '/MemTotal/{printf "%.1f GB", $2/1048576}' /proc/meminfo)"
  echo "cpu $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ //')"; echo "NODE_OPTIONS(ölçüm)=$BASEOPT"; date -u +%FT%TZ; } > "$OUT/ortam.txt"
SRC="$OUT/src$ROWS-ex"; node "$KIT/fixture-ex.js" "$APP_B" "$SRC" "$ROWS" > "$OUT/fixture.json"
declare -A RES; declare -A T0; declare -A T1; declare -A CV
node "$KIT/contention.js" record "$OUT/contention.jsonl" 5000 & CPID=$!; trap 'kill $CPID 2>/dev/null' EXIT
IDLE0=$(date -u +%FT%TZ); sleep 60; IDLE1=$(date -u +%FT%TZ)
cs() { node "$KIT/contention.js" summary "$OUT/contention.jsonl" "$1" "$2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const f=k=>o[k]?o[k].med+'/'+o[k].p90:'-';console.log('cpuSome '+f('cpuSome')+' · ioSome '+f('ioSome')+' · steal '+f('stealPct')+' · '+o.verdict)})"; }
EOPT() { echo "$BASEOPT${1:+ --require=$1}"; }
run_el() { local app=$1; shift; (cd "$app" && env -u BUYER_LOG_CP_ROWPATCH_LEGACY -u BUYER_LOG_COMPUTE_GC_RECHECK ELECTRON_RUN_AS_NODE=1 "$@"); }
verdict() { node -e "$1" "$2" && echo PASS || echo FAIL; }
step() { local s=$1 D="$OUT/$1"; mkdir -p "$D"; case $s in
  test)   (cd "$APP_B" && BUYER_LOG_TEST_SLOWEST=40 npm test > "$D/test.log" 2>&1) && RES[$s]=PASS || RES[$s]=FAIL ;;
  gate)   run_el "$APP_B" NODE_OPTIONS="--use-openssl-ca" "$EL" "$GATE_JS" --app "$APP_B" --fixture-app "$APP_B" \
             --out "$D/run" --rows "$ROWS" --soak-min 15 --heap-mb 3686 --strict-known > "$D/gate.log" 2>&1 && RES[$s]=PASS || RES[$s]=FAIL
          cp "$D/run/gate-report.json" "$D/" 2>/dev/null || true ;;
  shadow|shadowbase) local app=$APP_B; if [ $s = shadowbase ]; then app=$APP_A; fi
          run_el "$app" NODE_OPTIONS="$(EOPT)" timeout 3600 "$EL" "$KIT/shadow5.js" "$app" "$SRC" "$D/shadow.json" > "$D/shadow.log" 2>&1 || true
          RES[$s]=$(verdict "process.exit(require(process.argv[1]).pass===true?0:1)" "$D/shadow.json"); if [ $s = shadowbase ]; then RES[$s]="${RES[$s]} (bilgi)"; fi ;;
  hub)    run_el "$APP_B" NODE_OPTIONS="$(EOPT)" timeout 1800 "$EL" "$KIT/hub.js" "$APP_B" "$SRC" "$D/hub.json" > "$D/hub.log" 2>&1 || true
          RES[$s]=$(verdict "const r=require(process.argv[1]);process.exit(r.pass===true&&!r.errors.length?0:1)" "$D/hub.json") ;;
  perf)   : > "$D/runs.tsv"
          for b in $(seq 1 "$BLOCKS"); do case $(( (b-1) % 3 )) in 0) order="comb base aa";; 1) order="base aa comb";; *) order="aa comb base";; esac
            for arm in $order; do local app=$APP_B; if [ $arm = base ]; then app=$APP_A; fi; local a0; a0=$(date -u +%FT%TZ)
              run_el "$app" NODE_OPTIONS="$(EOPT)" timeout 2400 "$EL" "$KIT/perf3.js" "$app" "$SRC" "$arm" "$D/b$b-$arm.perf.json" > "$D/b$b-$arm.perf.log" 2>&1 || true
              run_el "$app" NODE_OPTIONS="$(EOPT)" timeout 1800 "$EL" "$KIT/fresh2.js" "$app" "$SRC" "$D/b$b-$arm.fresh.json" > "$D/b$b-$arm.fresh.log" 2>&1 || true
              printf '%s\t%s\t%s\t%s\t%s\n' "$b" "$arm" "$a0" "$(date -u +%FT%TZ)" "$(cs "$a0" "$(date -u +%FT%TZ)")" >> "$D/runs.tsv"; done; done
          node "$KIT/analyze-perf3.js" "$D" > "$D/perf-ozet.md" 2>&1 || true; RES[$s]="bkz. perf/perf-ozet.md (ölçüm; karar önceden yazılı bütçeye göre)" ;;
  soak|soakbase) local app=$APP_B min=$SOAK_MIN; if [ $s = soakbase ]; then app=$APP_A; min=$SOAK_BASE_MIN; fi
          run_el "$app" HOOK_LOG="$D/soak.hook" NODE_OPTIONS="$(EOPT "$KIT/hook-soak.js")" SOAK_MIN="$min" SOAK_GAP_MS=15000 SOAK_CHECK_MIN=10 \
             "$EL" "$KIT/soak.js" "$app" "$SRC" "$D/soak.json" > "$D/soak.log" 2>&1 || true
          mkdir -p "$D/analiz"; node "$KIT/analyze-soak.js" "$D/soak.json" "$D/soak.hook" "$D/analiz" > "$D/analiz/ozet.txt" 2>&1 || true
          RES[$s]=$(verdict "const r=require(process.argv[1]);const ch=r.checks||[];const ok=!r.errors.length&&ch.length>0&&ch.every(c=>c.equal&&c.values&&c.values.badCount===0)&&r.baseline&&r.baseline.equalToFinal&&r.edits.every(e=>e.save.status===200&&(e.cp.n503||0)===0&&(e.orders.n503||0)===0);process.exit(ok?0:1)" "$D/soak.json") ;;
  l2)     KIT="$KIT" SRC="$SRC" OUT="$D" APP_A="$APP_A" APP_B="$APP_B" EL="$EL" BASEOPT="$BASEOPT" bash "$KIT/run-t0-electron-2app.sh" && RES[$s]="bkz. l2/t0-ozet.txt" || RES[$s]=FAIL ;;
  *) echo "bilinmeyen adım $s"; exit 2;;
esac; }
for s in $STEPS; do n=0
  while :; do T0[$s]=$(date -u +%FT%TZ); echo "[final] $s başlıyor (deneme $((n+1))) $(date -u +%T)"; step "$s"; T1[$s]=$(date -u +%FT%TZ)
    CV[$s]=$(cs "${T0[$s]}" "${T1[$s]}"); echo "[final] $s → ${RES[$s]} · ${CV[$s]} $(date -u +%T)"
    case "${CV[$s]}" in *SAKİN*) break;; esac
    if [ $n -ge "$MAX_REPEAT" ]; then CV[$s]="${CV[$s]} — $((n+1)) denemede SAKİN pencere yok"; break; fi
    n=$((n+1)); mv "$OUT/$s" "$OUT/$s.deneme$n"; echo "$s deneme $n: ${RES[$s]} · ${CV[$s]}" >> "$OUT/tekrarlar.txt"; done
done
kill $CPID 2>/dev/null; sleep 1
{ echo "| Adım | Sonuç | Çekişme (PSI med/p90 %, steal %) |"; echo "|---|---|---|"; echo "| (boşta taban 60 sn) | — | $(cs "$IDLE0" "$IDLE1") |"
  for s in $STEPS; do echo "| $s | ${RES[$s]} | ${CV[$s]} |"; done; } > "$OUT/ozet.md"; cat "$OUT/ortam.txt" "$OUT/ozet.md"

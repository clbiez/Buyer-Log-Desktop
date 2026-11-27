#!/bin/bash
# 4 kollu: none (ikisi kapalı) / cp (yalnız #1236 pilotu) / gc (yalnız 503) / both + noneAA; 3 blok dönüşümlü.
# KIT=.. SRC=.. OUT=.. APP=<birleşik worktree resources/app>; NODE_OPTIONS'taki --max-old-space-size korunur.
set -u; mkdir -p "$OUT"; BASEOPT="${NODE_OPTIONS:-}"
echo "commit $(git -C "$APP" rev-parse HEAD) runtime=electron-44.3.0(ELECTRON_RUN_AS_NODE) NODE_OPTIONS=$BASEOPT" > "$OUT/commit.txt"
i=0
for arm in none cp gc both noneAA   noneAA both gc cp none   none cp gc both noneAA; do i=$((i+1))
  case $arm in cp|both) F=1;; *) F=0;; esac; case $arm in gc|both) G=1;; *) G=0;; esac
  (cd "$APP" && HOOK_LOG="$OUT/r$i-$arm.hook" NODE_OPTIONS="$BASEOPT --require=$KIT/hook-t0.js" BUYER_LOG_COMPUTE_GC_RECHECK=$G AB_FLAG=$F AB_INTENT=1 AB_EDITS=6 AB_GAP_MS=14000 ELECTRON_RUN_AS_NODE=1 timeout 1500 /tmp/claude-0/-home-user-Buyer-Log-Desktop/3ec04415-63af-5b6f-94d3-3a146562a817/scratchpad/electron/node_modules/electron/dist/electron "$KIT/ab8.js" "$APP" "$SRC" $arm "$OUT/r$i-$arm.json" > "$OUT/r$i-$arm.log" 2>&1)
done
node "$KIT/analyze4.js" "$OUT" > "$OUT/ozet.txt"; echo done > "$OUT/DONE"

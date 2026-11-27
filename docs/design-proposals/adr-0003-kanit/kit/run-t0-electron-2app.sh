#!/bin/bash
# İki kod dizinli aynı-t0 L2 (Electron, ELECTRON_RUN_AS_NODE=1): off/offAA = APP_A (taban main), on = APP_B (aday).
# Bayrak ortamı hiçbir kolda verilmez (AB_FLAG=0): her kol kendi varsayılan davranışını ölçer.
# Kullanım: KIT=.. SRC=.. OUT=.. APP_A=<main resources/app> APP_B=<aday resources/app> EL=<electron ikilisi> ./run-t0-electron-2app.sh
set -u; mkdir -p "$OUT"; BASEOPT="${BASEOPT:---use-openssl-ca --max-old-space-size=3686}"
VER=$(ELECTRON_RUN_AS_NODE=1 "$EL" -e 'process.stdout.write(process.versions.electron+" node "+process.versions.node)')
echo "A $(git -C "$APP_A" rev-parse HEAD) B $(git -C "$APP_B" rev-parse HEAD) runtime electron $VER ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS=$BASEOPT" > "$OUT/commit.txt"
i=0
for arm in off on offAA offAA on off off on offAA; do i=$((i+1)); APP=$APP_A; [ $arm = on ] && APP=$APP_B
  (cd "$APP" && env -u BUYER_LOG_CP_ROWPATCH_LEGACY -u BUYER_LOG_COMPUTE_GC_RECHECK ELECTRON_RUN_AS_NODE=1 HOOK_LOG="$OUT/r$i-$arm.hook" NODE_OPTIONS="$BASEOPT --require=$KIT/hook-t0.js" AB_FLAG=0 AB_INTENT=1 AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 "$EL" "$KIT/ab8.js" "$APP" "$SRC" $arm "$OUT/r$i-$arm.json" > "$OUT/r$i-$arm.log" 2>&1)
done
node "$KIT/analyze8.js" "$OUT" > "$OUT/t0-ozet.txt"; echo done > "$OUT/DONE"

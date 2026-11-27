#!/bin/bash
# #1236 aynı-t0 ölçümü (ADR-0003 §6L). Kullanım: KIT=.. SRC=.. OUT=.. APP=<resources/app> ./run-t0.sh
# AB_FLAG=1 → BUYER_LOG_CP_ROWPATCH_LEGACY=1. 4 kollu karşılaştırma için ek olarak BUYER_LOG_COMPUTE_GC_RECHECK ortam değişkenini kol başına verin.
set -u; mkdir -p "$OUT"; BASEOPT="${NODE_OPTIONS:-}"
echo "commit $(git -C "$APP" rev-parse HEAD) NODE_OPTIONS=$BASEOPT" > "$OUT/commit.txt"
i=0
for arm in off on offAA offAA on off off on offAA; do i=$((i+1)); F=0; [ $arm = on ] && F=1
  (cd "$APP" && HOOK_LOG="$OUT/r$i-$arm.hook" NODE_OPTIONS="$BASEOPT --require=$KIT/hook-t0.js" AB_FLAG=$F AB_INTENT=1 AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 node "$KIT/ab8.js" "$APP" "$SRC" $arm "$OUT/r$i-$arm.json" > "$OUT/r$i-$arm.log" 2>&1)
done
node "$KIT/analyze8.js" "$OUT" > "$OUT/t0-ozet.txt"; echo done > "$OUT/DONE"

#!/bin/bash
# 503 / not L2 (ADR-0003 §6K düzeneği). Kullanım:
#   KIT=<bu klasör> SRC=<30k fixture> OUT=<çıktı klasörü> PRE=<pre worktree resources/app> MAIN=<main worktree resources/app> ./run-l2.sh
# Kollar: mainoff, maingc, mainoffAA (A/A), preoff, pregc; 3 blok dönüşümlü. NODE_OPTIONS'taki --max-old-space-size KORUNUR
# (bayrak işçi resourceLimits'ini ezer; kaldırmak 503'ü gizler, bkz. §6K.1).
set -u; mkdir -p "$OUT"; BASEOPT="${NODE_OPTIONS:-}"
echo "pre $(git -C "$PRE" rev-parse HEAD) main $(git -C "$MAIN" rev-parse HEAD) NODE_OPTIONS=$BASEOPT" > "$OUT/commit.txt"
i=0
for arm in mainoff maingc mainoffAA preoff pregc   pregc preoff mainoffAA maingc mainoff   mainoff maingc mainoffAA preoff pregc; do i=$((i+1))
  case $arm in pre*) D=$PRE; I=0;; main*) D=$MAIN; I=1;; esac
  case $arm in *gc) G=1;; *) G=0;; esac
  (cd "$D" && HOOK_LOG="$OUT/r$i-$arm.hook" NODE_OPTIONS="$BASEOPT --require=$KIT/hook-mem.js" BUYER_LOG_COMPUTE_GC_RECHECK=$G AB_INTENT=$I AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 node "$KIT/ab3.js" "$D" "$SRC" $arm "$OUT/r$i-$arm.json" > "$OUT/r$i-$arm.log" 2>&1)
done
node "$KIT/analyze7.js" "$OUT" > "$OUT/ozet.txt"; echo done > "$OUT/DONE"

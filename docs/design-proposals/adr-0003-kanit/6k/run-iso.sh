#!/bin/bash
# Kanca/pilot karıştırıcı izolasyonu: X1 b7b172d saf kancasız, X2 b7b172d+pilot bayrak kapalı kancasız, X3 X2 + hook-lite. Sıra X1 X2 X3 X3 X2 X1.
S=/tmp/claude-0/-home-user-Buyer-Log-Desktop/5626984f-ab93-5f24-91fc-a9b33d469e27/scratchpad
i=0
for arm in x1 x2 x3 x3 x2 x1; do i=$((i+1))
  case $arm in x1) D=/home/user/main2/resources/app;; *) D=/home/user/pregc/resources/app;; esac
  if [ $arm = x3 ]; then H="HOOK_LOG=$S/gc/iso/r$i-$arm.hook NODE_OPTIONS=--require=$S/gc/hook-lite.js"; else H=""; fi
  (cd $D && env $H BUYER_LOG_COMPUTE_GC_RECHECK=0 AB_INTENT=0 AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 node $S/pilot/ab3.js $D $S/o3/source $arm $S/gc/iso/r$i-$arm.json > $S/gc/iso/r$i-$arm.log 2>&1)
done
echo done > $S/gc/iso/DONE

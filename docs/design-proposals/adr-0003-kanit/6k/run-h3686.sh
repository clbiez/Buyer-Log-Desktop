#!/bin/bash
# Üretim heap politikası (8 GB RAM → --max-old-space-size=3686) altında 503 sıklığı: main+pilot bayrak kapalı/açık, 4 koşu dönüşümlü.
S=/tmp/claude-0/-home-user-Buyer-Log-Desktop/5626984f-ab93-5f24-91fc-a9b33d469e27/scratchpad
until grep -q chain-done $S/../tasks/b372xd2lh.output 2>/dev/null; do sleep 15; done
D=/home/user/gc/resources/app; i=0
for arm in off on on off; do i=$((i+1)); G=0; [ $arm = on ] && G=1
  (cd $D && HOOK_LOG=$S/gc/h3686/r$i-$arm.hook NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686 --require=$S/gc/hook-mem.js" BUYER_LOG_COMPUTE_GC_RECHECK=$G AB_INTENT=1 AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 node $S/pilot/ab3.js $D $S/o3/source $arm $S/gc/h3686/r$i-$arm.json > $S/gc/h3686/r$i-$arm.log 2>&1)
done
echo done > $S/gc/h3686/DONE

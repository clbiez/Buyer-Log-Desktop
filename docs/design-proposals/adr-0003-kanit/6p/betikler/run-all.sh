#!/bin/bash
set -u; S=/tmp/claude-0/-home-user-Buyer-Log-Desktop/3ec04415-63af-5b6f-94d3-3a146562a817/scratchpad; KIT=$S/kit; SRC=$S/src30k; PRE=$S/wt/base/resources/app; MAIN=$S/wt/pr/resources/app
for H in 3686 8192; do
  OUT=$S/out/l2-$H; mkdir -p $OUT
  NODE_OPTIONS="--use-openssl-ca --max-old-space-size=$H" KIT=$KIT SRC=$SRC OUT=$OUT PRE=$PRE MAIN=$MAIN $KIT/run-l2.sh
done
for G in 1 0; do OUT=$S/out/long-3686-gc$G; mkdir -p $OUT
  (cd $MAIN && git rev-parse HEAD > $OUT/commit.txt && echo "NODE_OPTIONS=--use-openssl-ca --max-old-space-size=3686 GC=$G" >> $OUT/commit.txt && HOOK_LOG=$OUT/long.hook NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686 --require=$KIT/hook-mem.js" BUYER_LOG_COMPUTE_GC_RECHECK=$G AB_INTENT=1 AB_EDITS=200 AB_GAP_MS=5000 timeout 3600 node $KIT/ab3.js $MAIN $SRC long$G $OUT/long.json > $OUT/long.log 2>&1)
  node $KIT/analyze-long.js $OUT/long.json $OUT/long.hook > $OUT/ozet.txt 2>&1
done
echo done > $S/out/ALLDONE

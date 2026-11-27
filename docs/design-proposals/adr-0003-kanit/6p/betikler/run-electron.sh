#!/bin/bash
S=/tmp/claude-0/-home-user-Buyer-Log-Desktop/3ec04415-63af-5b6f-94d3-3a146562a817/scratchpad; KIT=$S/kit; SRC=$S/src30k; MAIN=$S/wt/pr/resources/app; E=/tmp/claude-0/-home-user-Buyer-Log-Desktop/3ec04415-63af-5b6f-94d3-3a146562a817/scratchpad/electron/node_modules/electron/dist/electron; NO="--use-openssl-ca --max-old-space-size=3686"
NODE_OPTIONS="$NO" KIT=$KIT SRC=$SRC OUT=$S/out/arm4-electron-3686 APP=$S/wt/both/resources/app $KIT/run-4arm-electron.sh
for G in 0 1; do OUT=$S/out/electron-long-3686-gc$G; mkdir -p $OUT; echo "main $(git -C $MAIN rev-parse HEAD) runtime=electron-44.3.0 NODE_OPTIONS=$NO GC=$G" > $OUT/commit.txt
(cd $MAIN && ELECTRON_RUN_AS_NODE=1 HOOK_LOG=$OUT/long.hook NODE_OPTIONS="$NO --require=$KIT/hook-mem.js" BUYER_LOG_COMPUTE_GC_RECHECK=$G AB_INTENT=1 AB_EDITS=120 AB_GAP_MS=5000 timeout 3600 $E $KIT/ab3.js $MAIN $SRC elong$G $OUT/long.json > $OUT/long.log 2>&1)
node $KIT/analyze-long.js $OUT/long.json $OUT/long.hook > $OUT/ozet.txt 2>&1; done
OUT=$S/out/fresh-electron-3686; mkdir -p $OUT; echo "main $(git -C $MAIN rev-parse HEAD) runtime=electron-44.3.0 NODE_OPTIONS=$NO" > $OUT/commit.txt
i=0; for arm in off gc gc off; do i=$((i+1)); G=0; [ $arm = gc ] && G=1
  (cd $MAIN && ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="$NO" BUYER_LOG_COMPUTE_GC_RECHECK=$G timeout 1500 $E $KIT/fresh2.js $MAIN $SRC $OUT/r$i-$arm.json > $OUT/r$i-$arm.log 2>&1)
done; echo done > $S/out/EDONE

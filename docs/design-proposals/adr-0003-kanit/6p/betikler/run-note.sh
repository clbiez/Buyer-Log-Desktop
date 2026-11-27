#!/bin/bash
S=/tmp/claude-0/-home-user-Buyer-Log-Desktop/3ec04415-63af-5b6f-94d3-3a146562a817/scratchpad; KIT=$S/kit; SRC=$S/src30k; E=/tmp/claude-0/-home-user-Buyer-Log-Desktop/3ec04415-63af-5b6f-94d3-3a146562a817/scratchpad/electron/node_modules/electron/dist/electron; NO="--use-openssl-ca --max-old-space-size=3686"; OUT=$S/out/note-electron-3686; mkdir -p $OUT
PRE=$S/wt/pre1243/resources/app; MAIN=$S/wt/base/resources/app
echo "pre1243 $(git -C $PRE rev-parse HEAD) (AB_INTENT=0, o dönemin istemci gövdesi) main $(git -C $MAIN rev-parse HEAD) (AB_INTENT=1) runtime=electron-44.3.0 ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS=$NO" > $OUT/commit.txt
i=0; for arm in pre main mainAA  mainAA main pre  pre main mainAA; do i=$((i+1)); case $arm in pre) D=$PRE; I=0;; *) D=$MAIN; I=1;; esac
 (cd $D && ELECTRON_RUN_AS_NODE=1 HOOK_LOG=$OUT/r$i-$arm.hook NODE_OPTIONS="$NO --require=$KIT/hook-mem.js" BUYER_LOG_COMPUTE_GC_RECHECK=0 AB_INTENT=$I AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 $E $KIT/ab3.js $D $SRC $arm $OUT/r$i-$arm.json > $OUT/r$i-$arm.log 2>&1)
done; echo done > $OUT/DONE

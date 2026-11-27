#!/bin/bash
set -u; S=/tmp/claude-0/-home-user-Buyer-Log-Desktop/3ec04415-63af-5b6f-94d3-3a146562a817/scratchpad; KIT=$S/kit; SRC=$S/src30k; MAIN=$S/wt/pr/resources/app; E=$S/electron/node_modules/electron/dist/electron
until [ -f $S/out/ALLDONE ]; do sleep 20; done
# Taban eşitliği: main 38ef051 (base) ↔ PR bayrak kapalı, ikisi de AB_INTENT=1, 3686, 3 dönüşümlü çift.
OUT=$S/out/parity-3686; mkdir -p $OUT; echo "base $(git -C $S/wt/base rev-parse HEAD) pr $(git -C $MAIN rev-parse HEAD) NODE_OPTIONS=--use-openssl-ca --max-old-space-size=3686" > $OUT/commit.txt
i=0; for arm in baseoff proff proff baseoff baseoff proff; do i=$((i+1)); case $arm in base*) D=$S/wt/base/resources/app;; *) D=$MAIN;; esac
  (cd $D && HOOK_LOG=$OUT/r$i-$arm.hook NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686 --require=$KIT/hook-mem.js" BUYER_LOG_COMPUTE_GC_RECHECK=0 AB_INTENT=1 AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 node $KIT/ab3.js $D $SRC $arm $OUT/r$i-$arm.json > $OUT/r$i-$arm.log 2>&1)
done; echo done > $OUT/DONE
# Electron 44.3.0 (ELECTRON_RUN_AS_NODE) altında gerçek sunucu: off on on off, 3686.
OUT=$S/out/electron-3686; mkdir -p $OUT; echo "main $(git -C $MAIN rev-parse HEAD) electron $($E --version 2>/dev/null) NODE_OPTIONS=--use-openssl-ca --max-old-space-size=3686" > $OUT/commit.txt
i=0; for arm in eoff egc egc eoff; do i=$((i+1)); G=0; [ $arm = egc ] && G=1
  (cd $MAIN && ELECTRON_RUN_AS_NODE=1 HOOK_LOG=$OUT/r$i-$arm.hook NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686 --require=$KIT/hook-mem.js" BUYER_LOG_COMPUTE_GC_RECHECK=$G AB_INTENT=1 AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 $E $KIT/ab3.js $MAIN $SRC $arm $OUT/r$i-$arm.json > $OUT/r$i-$arm.log 2>&1)
done; echo done > $OUT/DONE; echo done > $S/out/ELECTRONDONE
# 4 kollu (birleşik worktree), 3686
NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686" KIT=$KIT SRC=$SRC OUT=$S/out/arm4-3686 APP=$S/wt/both/resources/app $KIT/run-4arm.sh
# Güncellik (fresh2), PR commit'i, 3686: off on on off
OUT=$S/out/fresh-3686; mkdir -p $OUT; echo "main $(git -C $MAIN rev-parse HEAD) NODE_OPTIONS=--use-openssl-ca --max-old-space-size=3686" > $OUT/commit.txt
i=0; for arm in off gc gc off; do i=$((i+1)); G=0; [ $arm = gc ] && G=1
  (cd $MAIN && NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686" BUYER_LOG_COMPUTE_GC_RECHECK=$G timeout 1500 node $KIT/fresh2.js $MAIN $SRC $OUT/r$i-$arm.json > $OUT/r$i-$arm.log 2>&1)
done; echo done > $OUT/DONE; echo done > $S/out/STEP2DONE

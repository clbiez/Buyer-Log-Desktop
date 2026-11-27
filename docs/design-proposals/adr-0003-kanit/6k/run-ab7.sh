#!/bin/bash
# 503 pilotu + not L2 (bellek kancalı; sandbox NODE_OPTIONS korunur). Kollar: mainoff, maingc, mainoffAA (A/A), preoff, pregc. 3 blok, blok içi sıra dönüşümlü.
S=/tmp/claude-0/-home-user-Buyer-Log-Desktop/5626984f-ab93-5f24-91fc-a9b33d469e27/scratchpad
BASEOPT="$NODE_OPTIONS"
echo "pre $(git -C /home/user/pregc rev-parse HEAD) main $(git -C /home/user/gc rev-parse HEAD) NODE_OPTIONS=$BASEOPT" > $S/gc/ab7/commit.txt
i=0
for arm in mainoff maingc mainoffAA preoff pregc   pregc preoff mainoffAA maingc mainoff   mainoff maingc mainoffAA preoff pregc; do i=$((i+1))
  case $arm in pre*) D=/home/user/pregc/resources/app; I=0;; main*) D=/home/user/gc/resources/app; I=1;; esac
  case $arm in *gc) G=1;; *) G=0;; esac
  (cd $D && HOOK_LOG=$S/gc/ab7/r$i-$arm.hook NODE_OPTIONS="$BASEOPT --require=$S/gc/hook-mem.js" BUYER_LOG_COMPUTE_GC_RECHECK=$G AB_INTENT=$I AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 node $S/pilot/ab3.js $D $S/o3/source $arm $S/gc/ab7/r$i-$arm.json > $S/gc/ab7/r$i-$arm.log 2>&1)
done
echo done > $S/gc/ab7/DONE

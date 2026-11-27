#!/bin/bash
# #1236 t0 ölçümü: sabit commit (pilot worktree), bayrak kapalı/açık + A/A (kapalı ikinci etiket). 3 blok, dönüşümlü.
S=/tmp/claude-0/-home-user-Buyer-Log-Desktop/5626984f-ab93-5f24-91fc-a9b33d469e27/scratchpad
D=/home/user/pilot/resources/app; BASEOPT="$NODE_OPTIONS"
echo "commit $(git -C /home/user/pilot rev-parse HEAD) NODE_OPTIONS=$BASEOPT" > $S/gc/ab8/commit.txt
i=0
for arm in off on offAA offAA on off off on offAA; do i=$((i+1)); F=0; [ $arm = on ] && F=1
  (cd $D && HOOK_LOG=$S/gc/ab8/r$i-$arm.hook NODE_OPTIONS="$BASEOPT --require=$S/gc/hook-t0.js" AB_FLAG=$F AB_INTENT=1 AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 node $S/gc/ab8.js $D $S/o3/source $arm $S/gc/ab8/r$i-$arm.json > $S/gc/ab8/r$i-$arm.log 2>&1)
done
echo done > $S/gc/ab8/DONE

#!/bin/bash
# Electron L2: 3 ABBA blok (A=main 8a29116, B=aday HEAD) + 2 A/A blok; her örnek taze süreç.
E=/tmp/claude-0/el/node_modules/electron/dist/electron; A=/tmp/claude-0/wt-main/resources/app; B=/home/user/Buyer-Log-Desktop/resources/app; SRC=/tmp/claude-0/fx/src; OUT=/tmp/claude-0/m/el/ham6.jsonl
: > $OUT
run(){ ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686" REPB=5 REP=5 $E --expose-gc /tmp/claude-0/m/el/one.js "$2" $SRC | sed "s/^{/{\"block\":\"$3\",\"arm\":\"$1\",/" >> $OUT; }
for blk in 1 2 3; do run A $A ab$blk; run B $B ab$blk; run B $B ab$blk; run A $A ab$blk; done
for blk in 1 2; do run A $A aa$blk; run A2 $A aa$blk; run A2 $A aa$blk; run A $A aa$blk; done
echo done

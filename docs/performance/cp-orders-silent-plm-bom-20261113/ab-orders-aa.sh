#!/bin/bash
S=$SCRATCH
CAND=/home/user/Buyer-Log-Desktop/resources/app; MAIN=$S/bl-main/resources/app; SRC=/tmp/buyerlog-startup-Yz73HU/source
cd $CAND
run(){ timeout 900 node scripts/benchmark-startup-orders.js --rows 30000 --module orders --app-root $2 --source-fixture $SRC --out $S/perf/aa-$1-$3.json > $S/perf/aa-$1-$3.log 2>&1; echo "$(date +%T) aa $1 $3 exit=$?" >> $S/perf/ab.progress; }
run mainA $MAIN 1; run cand $CAND 1; run mainB $MAIN 1
run cand $CAND 2; run mainB $MAIN 2; run mainA $MAIN 2
run mainB $MAIN 3; run mainA $MAIN 3; run cand $CAND 3
echo AADONE >> $S/perf/ab.progress

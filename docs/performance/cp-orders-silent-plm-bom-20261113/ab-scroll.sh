#!/bin/bash
S=$SCRATCH
CAND=/home/user/Buyer-Log-Desktop/resources/app; MAIN=$S/bl-main/resources/app
run(){ cd $2 && timeout 900 node $S/ui/ui-check.js --app . --fixture /tmp/buyerlog-startup-Yz73HU --root /tmp/buyerlog-startup-scroll --mode scroll > $S/perf/scroll-$1-$3.log 2>&1; echo "$(date +%T) scroll $1 $3 exit=$?" >> $S/perf/ab.progress; }
run main $MAIN 1; run cand $CAND 1; run cand $CAND 2; run main $MAIN 2; run main $MAIN 3; run cand $CAND 3
echo SCROLLDONE >> $S/perf/ab.progress

#!/bin/bash
# Alternating Main/candidate CP+Orders open on identical 30k synthetic source bytes.
S=$SCRATCH
CAND=/home/user/Buyer-Log-Desktop/resources/app
MAIN=$S/bl-main/resources/app
SRC=/tmp/buyerlog-startup-Yz73HU/source
cd $CAND
run(){ # label app module idx
  timeout 900 node scripts/benchmark-startup-orders.js --rows 30000 --module $3 --app-root $2 --source-fixture $SRC --out $S/perf/open-$1-$3-$4.json > $S/perf/open-$1-$3-$4.log 2>&1
  echo "$(date +%T) $1 $3 $4 exit=$?" >> $S/perf/ab.progress
}
for mod in cp orders; do
  run main $MAIN $mod 1; run cand $CAND $mod 1
  run cand $CAND $mod 2; run main $MAIN $mod 2
  run main $MAIN $mod 3; run cand $CAND $mod 3
done
echo OPENDONE >> $S/perf/ab.progress

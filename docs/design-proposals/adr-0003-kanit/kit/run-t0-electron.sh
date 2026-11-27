#!/bin/bash
# #1236 aynı-t0 ölçümü, üretim temsilî çalışma ortamı (Electron, ELECTRON_RUN_AS_NODE=1). run-t0.sh ile aynı kol düzeni.
# Kullanım: KIT=.. SRC=.. OUT=.. APP=<resources/app> EL=<electron ikilisi> ./run-t0-electron.sh
# NODE_OPTIONS varsayılanı üretim politikası: --use-openssl-ca --max-old-space-size=3686 (+ ölçüm kancası).
set -u; mkdir -p "$OUT"; BASEOPT="${BASEOPT:---use-openssl-ca --max-old-space-size=3686}"
VER=$(ELECTRON_RUN_AS_NODE=1 "$EL" -e 'process.stdout.write(process.versions.electron+" node "+process.versions.node)')
echo "commit $(git -C "$APP" rev-parse HEAD) runtime electron $VER ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS=$BASEOPT" > "$OUT/commit.txt"
i=0
for arm in off on offAA offAA on off off on offAA; do i=$((i+1)); F=0; [ $arm = on ] && F=1
  (cd "$APP" && ELECTRON_RUN_AS_NODE=1 HOOK_LOG="$OUT/r$i-$arm.hook" NODE_OPTIONS="$BASEOPT --require=$KIT/hook-t0.js" AB_FLAG=$F AB_INTENT=1 AB_EDITS=6 AB_GAP_MS=14000 timeout 1500 "$EL" "$KIT/ab8.js" "$APP" "$SRC" $arm "$OUT/r$i-$arm.json" > "$OUT/r$i-$arm.log" 2>&1)
done
node "$KIT/analyze8.js" "$OUT" > "$OUT/t0-ozet.txt"; echo done > "$OUT/DONE"

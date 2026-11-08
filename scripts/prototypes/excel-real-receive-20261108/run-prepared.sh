#!/usr/bin/env bash
set -euo pipefail
packet=/tmp/buyerlog-excel-real-receive-preparation
lock=/tmp/buyerlog-performance-measurement.lock
nodebin=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node
[[ -f "$lock" ]] || { echo 'Existing common performance lock is required' >&2; exit 1; }
exec 9>>"$lock"
flock -n 9 || { echo 'Common performance lock held; nothing started' >&2; exit 1; }
export EXCEL_RECEIVE_COMMON_LOCK=held
case "${1:-}" in
 unit) exec "$nodebin" --test "$packet/observables.test.cjs" ;;
 probe) shift; exec timeout --signal=TERM --kill-after=15s 300s "$nodebin" "$packet/probe.cjs" "$@" ;;
 *) echo 'Prepared only: unit | probe --app-root ACTUAL_APP_ROOT --label UNIQUE_LABEL [--profile]' >&2; exit 2 ;;
esac

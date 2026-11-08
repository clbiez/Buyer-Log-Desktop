#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p docs/performance-program/shared-lease-lost-20261108
exec flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  "${DIAG_NODE:-node}" scripts/prototypes/shared-lease-lost-20261108/run.cjs "$@"

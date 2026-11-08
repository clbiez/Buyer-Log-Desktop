#!/usr/bin/env bash
set -euo pipefail
seed=$(realpath "$1")
output=$2
test ! -e "$output"
mkdir -p "$output"
script=$(dirname "$(realpath "$0")")
# Independent fresh server processes. Scenario differences are not code changes.
for spec in backup-only:1 backup-interactive:1 backup-interactive:2 backup-only:2 backup-only:3 backup-interactive:3 profile:1 profile:2 profile:3; do
  scenario=${spec%:*}
  ordinal=${spec#*:}
  name=$scenario-$ordinal
  node "$script/run.cjs" run "$seed" "$output/$name" "$scenario" "$ordinal" > "$output/$name.driver.log" 2>&1
done
node "$script/analyze.cjs" "$output"

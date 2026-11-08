#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
evidence=docs/performance-program/contrib-int06-checkpoint-journal-20261108
node resources/app/tests/fixtures/int06-checkpoint-journal/cohort.cjs "$evidence/measurements" 30000 steady
node resources/app/tests/fixtures/int06-checkpoint-journal/cohort.cjs "$evidence/measurements" 100000 steady

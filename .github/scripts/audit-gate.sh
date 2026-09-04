#!/usr/bin/env bash
# =============================================================================
# DEPENDENCY AUDIT GATE
#
# `npm audit` exits non-zero for two unrelated reasons: a CRITICAL advisory was
# found, or npm's advisory endpoint could not be reached. The workflow could
# not tell them apart, so a registry outage failed the build exactly as a
# vulnerable dependency would — on 2026-09-03 a 503 from
# /-/npm/v1/security/advisories/bulk failed a pull request whose entire diff
# was one new React layout file.
#
# This is the same defect the ECR scan gate had, one layer down: A GATE MUST
# DISTINGUISH "THE CHECK COULD NOT RUN" FROM "THE CHECK FAILED". Only the
# second is a reason to refuse the change.
#
# FAILS CLOSED after the retries. A supply-chain gate that passes when it could
# not look is worse than one that is occasionally slow: the build would go
# green having checked nothing, which is the state this exists to prevent.
# Retrying converts a transient outage into a delay rather than into a lie.
#
# Usage: audit-gate.sh
# =============================================================================
set -euo pipefail

ATTEMPTS="${AUDIT_ATTEMPTS:-3}"
LEVEL="${AUDIT_LEVEL:-critical}"

# npm retries internally before it reports anything, and its defaults are
# generous enough that a dead endpoint costs about five minutes per attempt.
# Lowered so this script's own retries are the ones that matter and the total
# stays bounded — three attempts of roughly a minute rather than three of five.
FETCH_ARGS=(--fetch-retries=1 --fetch-retry-maxtimeout=20000)

for attempt in $(seq 1 "$ATTEMPTS"); do
  if output=$(npm audit --audit-level="$LEVEL" "${FETCH_ARGS[@]}" 2>&1); then
    echo "$output"
    echo "No $LEVEL advisories."
    exit 0
  fi

  # Matched on npm's own wording for a transport failure. Anything else — most
  # importantly an actual advisory — falls through and fails on the first
  # attempt, because retrying a real finding only delays the same answer.
  case "$output" in
  *"audit endpoint returned an error"* | *"Service Unavailable"* | *ENOTFOUND* | *ETIMEDOUT* | *ECONNRESET* | *EAI_AGAIN*)
    echo "::warning::npm advisory endpoint unreachable (attempt $attempt of $ATTEMPTS)"
    [ "$attempt" -lt "$ATTEMPTS" ] && sleep $((attempt * 15))
    ;;
  *)
    echo "$output"
    echo "::error::npm audit found advisories at or above $LEVEL."
    exit 1
    ;;
  esac
done

echo "$output"
echo "::error::npm advisory endpoint unreachable after $ATTEMPTS attempts; refusing to report a dependency audit that never ran."
exit 1

#!/usr/bin/env bash
# =============================================================================
# ECR SCAN GATE
#
# Refuses to deploy an image carrying CRITICAL findings, except those assessed
# and recorded in .github/image-cve-allowlist.json.
#
# One script rather than the same shell inlined in two workflows. The gate is
# security policy, and policy that exists in two places is policy that will
# disagree with itself — staging accepting what production rejects is the exact
# asymmetry the gate was extended to staging to remove.
#
# CRITICAL ONLY, and that threshold is measured rather than guessed: the images
# carry seven HIGH findings, every one an openssl CVE inherited from
# node:24-alpine and unfixable from this repository. Failing on HIGH would block
# every deploy on Alpine's patch schedule, which is how a gate gets deleted.
# Dependabot's Docker updates are the path by which those get fixed.
#
# The allowlist is what keeps CRITICAL usable without weakening it. An entry is
# an assessment of why the vulnerable code cannot be reached by the image
# carrying it, and it expires — so an exception is a question deferred to a
# date, not a finding deleted.
#
# Usage: scan-gate.sh <repository> <image-tag>
# =============================================================================
set -euo pipefail

REPO="${1:?repository required}"
IMAGE_TAG="${2:?image tag required}"
# Resolved against this script rather than the caller's cwd. Both workflows
# happen to invoke it from the repository root, so a relative default works
# today and would break silently the first time one of them sets a
# working-directory — as the Python job in ci.yml already does.
ALLOWLIST="${ALLOWLIST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/image-cve-allowlist.json}"

# Scanning is asynchronous. Findings read immediately after a push are empty,
# which would report every image clean.
aws ecr wait image-scan-complete \
  --repository-name "$REPO" --image-id "imageTag=$IMAGE_TAG"

# Fetched once and filtered with jq rather than twice with JMESPath --query. A
# JMESPath literal is written in backticks, which the linter reads as command
# substitution suppressed by single quotes (SC2016) — correct about the shell,
# wrong about the query.
findings=$(aws ecr describe-image-scan-findings \
  --repository-name "$REPO" --image-id "imageTag=$IMAGE_TAG" --output json)

echo "$REPO:$IMAGE_TAG severities: $(echo "$findings" | jq -c '.imageScanFindings.findingSeverityCounts')"

# EXPIRY IS CHECKED BEFORE ANYTHING ELSE, and against the whole file rather
# than only the entries this image needs. An exception that has lapsed is a
# question nobody answered; letting it fail only on the image that still
# carries the finding would let it rot quietly on every other build.
#
# ISO dates compare correctly as strings, which avoids `date -d` — GNU-only,
# and this runs on a developer's machine as readily as on a runner.
today=$(date -u +%Y-%m-%d)
expired=$(jq -r --arg today "$today" \
  '.exceptions[] | select(.expires < $today) | "\(.cve) (\(.package)) expired \(.expires)"' \
  "$ALLOWLIST")
if [ -n "$expired" ]; then
  echo "::error::$ALLOWLIST has expired entries; re-assess them or extend the expiry."
  echo "$expired"
  exit 1
fi

# The decision reads findingSeverityCounts for the report, but the accept/deny
# reads the findings themselves: counts cannot be matched against an allowlist.
# Findings paginate, so anything relying on the array being complete would be
# wrong — but CRITICAL findings are few enough to enumerate, and a name missing
# from a truncated page fails closed rather than open.
critical=$(echo "$findings" | jq -r '.imageScanFindings.findings[]? | select(.severity == "CRITICAL") | .name' | sort -u)

if [ -z "$critical" ]; then
  echo "$REPO:$IMAGE_TAG has no CRITICAL findings."
  exit 0
fi

accepted=$(jq -r --arg repo "$REPO" '.exceptions[] | select(.repos | index($repo)) | .cve' "$ALLOWLIST" | sort -u)

# comm needs sorted input, which both sides are.
unaccepted=$(comm -23 <(echo "$critical") <(echo "$accepted"))

for cve in $critical; do
  if echo "$accepted" | grep -qx "$cve"; then
    reason=$(jq -r --arg cve "$cve" --arg repo "$REPO" \
      '.exceptions[] | select(.cve == $cve and (.repos | index($repo))) | "\(.package), expires \(.expires)"' "$ALLOWLIST")
    echo "  accepted: $cve — $reason"
  fi
done

if [ -n "$unaccepted" ]; then
  echo "::error::$REPO:$IMAGE_TAG has CRITICAL finding(s) with no assessment; refusing to deploy."
  for cve in $unaccepted; do
    echo "$findings" | jq -r --arg cve "$cve" \
      '.imageScanFindings.findings[]? | select(.name == $cve) | "\(.name)\t\(.attributes[]? | select(.key == "package_name") | .value)\t\(.uri)"'
  done
  exit 1
fi

echo "$REPO:$IMAGE_TAG: all CRITICAL findings are assessed and unexpired."

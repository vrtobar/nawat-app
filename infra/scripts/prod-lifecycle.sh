#!/bin/bash
# =============================================================================
# NAHUAT — PRODUCTION LIFECYCLE (pre-launch)
#
# Brings the production APPLICATION layer up or tears it down, for the
# disposable-during-pre-launch posture in ADR 17. Run by a human with
# production Terraform credentials — CI stays read-only on production state
# (ADR 1), so this is deliberately not a workflow.
#
# It operates on production/application ONLY. It never touches the foundation
# or global layers: foundation holds the domain, the maintenance page, the
# assets bucket and the state itself, and destroying it is unrecoverable.
#
# Usage:
#   prod-lifecycle.sh up               # deploy main's current commit
#   prod-lifecycle.sh up <image_tag>   # pin a specific release, e.g. prod-<sha>
#   prod-lifecycle.sh down
#
# See docs/production-lifecycle.md for the full release-rehearsal sequence
# (bring up -> deploy via CI -> verify -> tear down).
# =============================================================================

set -euo pipefail

# Resolve TF_DIR from this script's location so it cannot be pointed elsewhere
# by the caller's working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$SCRIPT_DIR/../terraform/environments/production/application"

# Hard guard: refuse to run against anything but the application layer, however
# the path resolves. This is the whole point of the script.
case "$TF_DIR" in
  */production/application) : ;;
  *)
    echo "REFUSING: TF_DIR is not production/application ($TF_DIR)" >&2
    exit 1
    ;;
esac

# image_tag has no default in the application layer (same reason as staging:
# a default would let an apply quietly deploy an image nobody chose). destroy
# does not use the image but the variable is still required, so it is passed a
# well-formed placeholder rather than made optional.
PLACEHOLDER_TAG="prod-0000000000000000000000000000000000000000"

# The API repo is the one checked for a bring-up image; api and web are built
# from the same commit, so a present prod-<sha> on one implies the other.
ECR_API_REPO="nahuat-api"

usage() {
  echo "Usage: $0 up [image_tag] | down" >&2
  exit 1
}

action="${1:-}"
case "$action" in
  up)
    # Default to main's current commit so the common case needs no lookup; an
    # explicit tag still pins a specific release.
    image_tag="${2:-}"
    if [ -z "$image_tag" ]; then
      sha="$(git -C "$SCRIPT_DIR" rev-parse origin/main)"
      image_tag="prod-$sha"
      echo "No tag given; using main @ ${sha:0:12} -> $image_tag"
    fi

    # Fail before the apply if that image is not in ECR — the apply would
    # otherwise create services that can never pull, and the failure would
    # surface minutes later as a placement error rather than here.
    if ! aws ecr describe-images --repository-name "$ECR_API_REPO" \
         --image-ids "imageTag=$image_tag" >/dev/null 2>&1; then
      echo "REFUSING: $ECR_API_REPO:$image_tag is not in ECR." >&2
      echo "Build it by running the Production workflow on the commit you want." >&2
      echo "Recent prod images:" >&2
      aws ecr describe-images --repository-name "$ECR_API_REPO" \
        --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:10].imageTags[]' \
        --output text 2>/dev/null | tr '\t' '\n' | grep '^prod-' >&2 || true
      exit 1
    fi

    echo "=== production/application: APPLY (image_tag=$image_tag) ==="
    terraform -chdir="$TF_DIR" init -input=false
    terraform -chdir="$TF_DIR" apply -input=false \
      -var "image_tag=$image_tag"
    echo ""
    echo "Application layer applied. Migrations and reference seed do NOT run"
    echo "from here — trigger the Production deploy workflow to migrate, seed"
    echo "and roll onto this image, then verify https://nahuat.com."
    ;;
  down)
    echo "=== production/application: DESTROY ==="
    echo "This destroys the ALB, both services, RDS (and its data), ElastiCache"
    echo "and the NAT gateway. nahuat.com will fail over to the maintenance page."
    echo "Foundation and global layers are untouched."
    echo ""
    read -r -p 'Type "destroy production" to proceed: ' confirm
    [ "$confirm" = "destroy production" ] || { echo "Aborted." >&2; exit 1; }
    terraform -chdir="$TF_DIR" init -input=false
    terraform -chdir="$TF_DIR" destroy -input=false \
      -var "image_tag=$PLACEHOLDER_TAG"
    echo ""
    echo "Application layer destroyed. Confirm https://nahuat.com shows the"
    echo "maintenance page."
    ;;
  *)
    usage
    ;;
esac

#!/usr/bin/env bash
# =============================================================================
# IMAGE SMOKE TEST — does the artifact we just built actually start?
#
# CI proved a great deal about the source and nothing about the image. On
# 2026-09-04 a commit passed lint, format, typecheck, 384 unit tests, 17
# integration tests, CodeQL and three image builds, and the API image it
# produced could not boot: `@nestjs/platform-express` was installed in a
# workspace directory the runner stage never copied, so every ECS task exited 1
# with "No driver (HTTP) has been selected". Nothing in the pipeline runs a
# built image, so nothing could have noticed.
#
# The defect is invisible to every other check by construction. A test suite
# resolves modules from the repository, where the package is present and
# reachable; only the pruned image is missing it.
#
# Usage: smoke-image.sh <api|web|media-consumer> <image-ref>
# =============================================================================
set -euo pipefail

NAME=${1:?image name required}
IMAGE=${2:?image ref required}

CONTAINER="smoke-$NAME-$$"

cleanup() {
  # Logs BEFORE removal, and on success too: a container that started and then
  # logged a stack trace is worth seeing even when the probe passed.
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "::group::$NAME container logs"
    docker logs "$CONTAINER" 2>&1 | tail -60 || true
    echo "::endgroup::"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Polls until the endpoint answers 200, or gives up. Also fails fast if the
# container has already exited — otherwise a container that dies on boot is
# indistinguishable from a slow one until the timeout expires.
wait_for_http() {
  local url=$1 deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
      local code
      code=$(docker inspect -f '{{.State.ExitCode}}' "$CONTAINER" 2>/dev/null || echo '?')
      echo "::error::$NAME container exited (code $code) before serving $url"
      return 1
    fi
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)" = "200" ]; then
      echo "$NAME: $url -> 200"
      return 0
    fi
    sleep 2
  done
  echo "::error::$NAME did not serve 200 from $url within 90s"
  return 1
}

case "$NAME" in
  api)
    # Enough configuration to satisfy env validation and the signing-key import,
    # and no more.
    #
    # DATABASE_URL and REDIS_URL point at nothing, and that is the point: both
    # clients connect lazily and /api/health is liveness with no dependency
    # checks, so the API boots and serves without either service existing. This
    # stays a test of the IMAGE rather than of a fixture. They cannot simply be
    # omitted — each is optional alone but a cross-field rule requires one form
    # of each, so an absent pair fails validation before the driver is reached.
    #
    # The key is generated here rather than hardcoded. A committed private key
    # is a committed private key even when it is only for CI, and the signing
    # set is parsed and imported at startup, so a placeholder string would fail
    # the boot it is meant to be testing.
    keys=$(node -e '
      const { generateKeyPairSync } = require("crypto");
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = privateKey.export({ format: "jwk" });
      jwk.kid = "smoke"; jwk.alg = "RS256"; jwk.use = "sig";
      process.stdout.write(Buffer.from(JSON.stringify({ keys: [jwk] })).toString("base64"));
    ')
    docker run -d --name "$CONTAINER" \
      -p 127.0.0.1:13000:3000 \
      -e JWT_SIGNING_KEYS="$keys" \
      -e JWT_ISSUER=https://smoke.invalid \
      -e JWT_AUDIENCE=smoke \
      -e GOOGLE_CLIENT_ID=smoke.apps.googleusercontent.com \
      -e S3_BUCKET=smoke-bucket \
      -e CDN_URL=https://cdn.smoke.invalid \
      -e DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:5432/smoke \
      -e REDIS_URL=redis://127.0.0.1:6379 \
      "$IMAGE" >/dev/null
    wait_for_http http://127.0.0.1:13000/api/health
    ;;

  web)
    # The web app holds no connection of its own and its /api/health is
    # liveness only, so it needs nothing to answer.
    docker run -d --name "$CONTAINER" \
      -p 127.0.0.1:13001:3000 \
      "$IMAGE" >/dev/null
    wait_for_http http://127.0.0.1:13001/api/health
    ;;

  media-consumer)
    # A Lambda image, so there is no server to probe: the entrypoint is the
    # Lambda runtime interface client, which expects an invocation. Importing
    # the handler is the equivalent check — it executes every module-level
    # import, which is where a missing dependency or a bad layer path shows up,
    # and it is exactly what the runtime does before the first invocation.
    #
    # config.py reads its settings with os.environ[...] at module scope, so the
    # import fails without them. That is the module behaving correctly — a
    # missing setting stops the Lambda at load rather than mid-transcode — and
    # it means these placeholders are part of the check, not a workaround for
    # it. Nothing is connected to: the import only reads the values.
    docker run --name "$CONTAINER" --entrypoint python \
      -e ASSETS_BUCKET=smoke-bucket \
      -e DB_SECRET_ARN=arn:aws:secretsmanager:us-east-1:000000000000:secret:smoke \
      -e DB_HOST=127.0.0.1 \
      -e DB_NAME=smoke \
      "$IMAGE" \
      -c 'import media_consumer.handler, media_consumer.reaper; print("media-consumer: handler and reaper imported")'
    ;;

  *)
    echo "::error::unknown image name '$NAME'"
    exit 1
    ;;
esac

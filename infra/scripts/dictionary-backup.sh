#!/bin/bash
# =============================================================================
# NAHUAT — DICTIONARY BACKUP
#
# Exports the dictionary out of an environment's database into S3, and restores
# it back. The content — entries and translations — not the database: users,
# tokens and audit rows are excluded, and "the whole database" is an RDS
# snapshot's job.
#
# WHY IT IS NEEDED. RDS lives in the application layer, so the teardown that
# ADR 17 makes routine before launch destroys the content with it. The bucket
# lives in FOUNDATION, which survives, so an export taken before `down` can be
# restored into an environment rebuilt from nothing.
#
# The heavy lifting is in packages/database: `db:export` and `db:import` speak
# to the database; this script resolves WHICH database, moves files and picks
# keys.
#
# THE ENVIRONMENT ARGUMENT IS AUTHORITATIVE FOR BOTH the bucket and the
# database, and that is not a convenience — it is the whole safety property.
# An earlier version took the bucket from this argument and let the database
# come from the caller's environment, and the two silently disagreed: a run
# labelled `export staging` read the LOCAL development database and uploaded 42
# local rows into staging's prefix. Nothing in the output said so.
#
# Ambient configuration cannot be trusted here, because `packages/database/.env`
# sets DATABASE_URL for local development and `export.ts` loads it through
# `dotenv/config`. `buildDatabaseUrl()` checks DATABASE_URL before DB_*, so
# exporting DB_HOST/DB_PORT and friends does NOT redirect the connection — the
# .env wins, silently, and points at localhost. This script therefore builds
# DATABASE_URL itself from the named environment's Terraform outputs and RDS
# secret, and passes it explicitly so nothing ambient can win.
#
# It does NOT open the tunnel. `db-tunnel.sh` runs in the foreground and cannot
# see its own SSM session id, so a wrapper that backgrounds and kills it leaves
# the session Active for 20 minutes (see that script's header). Open the tunnel
# in another terminal; this refuses to run without one.
#
# Usage:
#   dictionary-backup.sh export <staging|production>          # db -> S3
#   dictionary-backup.sh restore <staging|production> [key]   # S3 -> db
#   dictionary-backup.sh list <staging|production>            # what is in S3
#
# `restore` without a key takes the newest export for that environment. Pass a
# key to restore an older one; `list` prints them.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

usage() {
  echo "Usage: $0 export <staging|production>" >&2
  echo "       $0 restore <staging|production> [key]" >&2
  echo "       $0 list <staging|production>" >&2
  exit 1
}

action="${1:-}"
env_name="${2:-}"

case "$env_name" in
  staging | production) : ;;
  *) usage ;;
esac

# The bucket name is read from Terraform rather than reconstructed here. It
# embeds the account id, and a second copy of that rule would be one more thing
# that can disagree with the first.
FOUNDATION_DIR="$REPO_ROOT/infra/terraform/environments/$env_name/foundation"
BUCKET="$(terraform -chdir="$FOUNDATION_DIR" output -raw backups_bucket_name 2>/dev/null || true)"

if [ -z "$BUCKET" ]; then
  echo "Could not read backups_bucket_name from $env_name/foundation." >&2
  echo "Run 'terraform -chdir=$FOUNDATION_DIR init' first, or apply the layer if" >&2
  echo "the bucket has not been created yet." >&2
  exit 1
fi

# One prefix per environment inside the bucket, even though each environment
# has its own bucket. It costs nothing and makes a file that gets copied between
# buckets by hand still say where it came from.
PREFIX="dictionary/$env_name"

# -----------------------------------------------------------------------------
# WHICH DATABASE
#
# Skipped for `list`, which only ever touches S3 — requiring a tunnel to read a
# bucket listing would be friction with nothing behind it.
# -----------------------------------------------------------------------------
TUNNEL_PORT="${DB_TUNNEL_PORT:-5433}" # db-tunnel.sh's default local port

if [ "$action" != "list" ]; then
  APPLICATION_DIR="$REPO_ROOT/infra/terraform/environments/$env_name/application"
  outputs="$(terraform -chdir="$APPLICATION_DIR" output -json 2>/dev/null || true)"
  rds_endpoint="$(printf '%s' "${outputs:-}" | jq -r '.rds_endpoint.value // empty' 2>/dev/null || true)"

  if [ -z "$rds_endpoint" ]; then
    echo "No rds_endpoint output for $env_name — is the application layer up?" >&2
    exit 1
  fi

  # Refuse before doing anything rather than failing inside Prisma with a
  # connection error that says nothing about which environment was meant.
  if ! nc -z localhost "$TUNNEL_PORT" 2>/dev/null; then
    echo "Nothing is listening on localhost:$TUNNEL_PORT." >&2
    echo "Open the tunnel in another terminal first:" >&2
    echo "  infra/scripts/db-tunnel.sh $env_name" >&2
    exit 1
  fi

  db_secret_arn="$(printf '%s' "$outputs" | jq -r '.db_secret_arn.value // empty')"
  db_name="$(printf '%s' "$outputs" | jq -r '.rds_db_name.value // "nahuat"')"
  secret_json="$(aws secretsmanager get-secret-value \
    --secret-id "$db_secret_arn" --query SecretString --output text)"

  # Percent-encoded through jq's @uri. The RDS-managed password contains
  # URL-special characters, and an unencoded one produces a string that psql
  # accepts and Node's URL parser rejects outright with `Invalid URL` — which is
  # how `db-tunnel.sh --print-dsn` output came to be unusable here.
  db_user="$(printf '%s' "$secret_json" | jq -r '.username // "postgres" | @uri')"
  db_pass="$(printf '%s' "$secret_json" | jq -r '.password // empty | @uri')"

  # sslmode=no-verify, matching buildDatabaseUrl(): RDS ships rds.force_ssl=1 so
  # an unencrypted connection is refused, and the certificate names the RDS
  # endpoint rather than the localhost the tunnel presents, so verification
  # cannot succeed through a forwarded port.
  export DATABASE_URL="postgresql://$db_user:$db_pass@localhost:$TUNNEL_PORT/$db_name?sslmode=no-verify"

  # -----------------------------------------------------------------------
  # WHICH INSTANCE IS ACTUALLY ON THE OTHER END
  #
  # The environment argument selects the bucket and the credentials. It cannot
  # select which RDS instance the tunnel terminates at — from here every
  # environment is `localhost:$TUNNEL_PORT`. Open a tunnel to production, type
  # `export staging`, and production's rows are read and written into staging's
  # bucket with every message along the way saying "staging". The `restore`
  # direction is worse: it writes.
  #
  # inet_server_addr() is answered by the server, so it names the instance
  # actually reached. The RDS endpoint resolves publicly to that same private
  # address, so the two are directly comparable.
  # -----------------------------------------------------------------------
  expected_addr="$(dig +short "$rds_endpoint" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -1 || true)"
  actual_addr="$(npm run --silent db:server-address --workspace=@nahuat/database 2>/dev/null | tr -d '[:space:]' || true)"

  if [ -z "$expected_addr" ] || [ -z "$actual_addr" ]; then
    # UNVERIFIABLE IS NOT THE SAME AS MISMATCHED, and the two directions deserve
    # different answers. A missing `dig`, or a socket connection where
    # inet_server_addr() is NULL, means the check could not run — not that
    # anything is wrong — so refusing every time would block work for a reason
    # unrelated to the danger.
    #
    # But `restore` WRITES. A mislabelled export is a file someone deletes; a
    # restore into the wrong database is a corrupted environment and, if it went
    # to production, one whose previous contents are already gone. So export and
    # list warn, and restore refuses until the check can run.
    echo "WARNING: could not confirm which instance the tunnel reaches." >&2
    echo "  expected (DNS): ${expected_addr:-unknown}   actual (server): ${actual_addr:-unknown}" >&2

    if [ "$action" = "restore" ]; then
      echo "" >&2
      echo "REFUSING to restore into an instance that cannot be identified." >&2
      echo "Restore writes, so an unverified target is not a risk worth taking." >&2
      exit 1
    fi
  elif [ "$expected_addr" != "$actual_addr" ]; then
    echo "REFUSING: the tunnel does not reach $env_name." >&2
    echo "" >&2
    echo "  $env_name is $rds_endpoint ($expected_addr)" >&2
    echo "  localhost:$TUNNEL_PORT reaches $actual_addr" >&2
    echo "" >&2
    echo "Close the tunnel and reopen it against $env_name:" >&2
    echo "  infra/scripts/db-tunnel.sh $env_name" >&2
    echo "" >&2
    echo "If $env_name recently failed over, its address may have changed and this" >&2
    echo "is a false alarm — re-check the endpoint before overriding anything." >&2
    exit 1
  fi

  # Named before anything is read or written.
  echo "Database: $db_name on $rds_endpoint ($actual_addr) via localhost:$TUNNEL_PORT"
fi

case "$action" in
  export)
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    tmp="$(mktemp -t nawat-dictionary)"
    # Delete the local copy however this exits. The file is a snapshot of the
    # content and does not belong in someone's temp directory afterwards.
    trap 'rm -f "$tmp"' EXIT

    npm run --silent db:export --workspace=@nahuat/database -- --out "$tmp"

    # Refuse to upload an export with no entries. It is a valid file and a
    # legitimate state for a fresh environment, but as an upload it is almost
    # always the sign of a database that is not the one that was meant — a
    # tunnel pointing somewhere unexpected, or a restore that has not run yet.
    # Uploading it would put an empty snapshot at the top of the list, which is
    # what `restore` reaches for by default.
    # readFileSync rather than require(): mktemp produces a file with no .json
    # extension, which require() refuses to parse.
    count="$(node -e 'const fs=require("node:fs");process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).counts.entries))' "$tmp")"
    if [ "$count" -eq 0 ]; then
      echo "REFUSING: the export contains 0 entries." >&2
      echo "The database named above is empty. If that is not the one you meant," >&2
      echo "check which environment the open tunnel targets. To store it anyway:" >&2
      echo "  aws s3 cp <file> s3://$BUCKET/$PREFIX/$stamp.json" >&2
      exit 1
    fi

    key="$PREFIX/$stamp.json"
    aws s3 cp "$tmp" "s3://$BUCKET/$key"
    # A second copy at a stable key, so the newest export has a name that can be
    # written down. The timestamped objects are the history; versioning on the
    # bucket keeps this one's past too.
    aws s3 cp "s3://$BUCKET/$key" "s3://$BUCKET/$PREFIX/latest.json"

    echo "Exported $count entries -> s3://$BUCKET/$key"
    ;;

  restore)
    key="${3:-$PREFIX/latest.json}"
    tmp="$(mktemp -t nawat-dictionary)"
    trap 'rm -f "$tmp"' EXIT

    aws s3 cp "s3://$BUCKET/$key" "$tmp"

    # Deliberately interactive. Import merges into whatever is already there,
    # and the environment name is the thing worth reading twice.
    echo "About to import s3://$BUCKET/$key into the database DB_* currently points at."
    echo "Import upserts: rows in the file overwrite matching rows, rows absent from"
    echo "the file are left alone."
    read -r -p "Type \"$env_name\" to proceed: " confirm
    [ "$confirm" = "$env_name" ] || { echo "Aborted." >&2; exit 1; }

    npm run --silent db:import --workspace=@nahuat/database -- "$tmp"
    ;;

  list)
    # Counted with list-objects-v2 rather than testing `aws s3 ls`'s exit code,
    # which is 1 both when a prefix matches nothing and when the call actually
    # fails. An empty bucket is the normal state of a new one, not an error, and
    # collapsing the two would report "no exports" for an access denial — the
    # one case where a wrong answer is dangerous, since the next step is a
    # teardown.
    count="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$PREFIX/" \
      --query 'length(Contents || `[]`)' --output text)"

    if [ "$count" -eq 0 ]; then
      echo "No exports in s3://$BUCKET/$PREFIX/"
    else
      aws s3 ls "s3://$BUCKET/$PREFIX/" --human-readable
    fi
    ;;

  *)
    usage
    ;;
esac

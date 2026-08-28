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
# to the database, this script only moves files and picks keys. It talks to
# whatever database DATABASE_URL / DB_* point at — for a deployed environment
# that means an open bastion tunnel (docs/production-lifecycle.md).
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
      echo "Check which database DB_* points at. To store it anyway, upload by hand:" >&2
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
    aws s3 ls "s3://$BUCKET/$PREFIX/" --human-readable
    ;;

  *)
    usage
    ;;
esac

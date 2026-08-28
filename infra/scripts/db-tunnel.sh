#!/bin/bash
# =============================================================================
# NAHUAT — DATABASE TUNNEL
#
# Forwards a local port to an environment's RDS instance through the SSM
# bastion, so psql or any GUI client can connect to a database that is not
# reachable from the internet.
#
# There is no other path. RDS is publicly_accessible = false in private
# subnets, and ECS Exec is disabled — and Exec would not help anyway, since
# `ecs execute-command` runs an interactive command inside a task while port
# forwarding needs an SSM managed instance, which a Fargate task is not.
#
# Usage:
#   db-tunnel.sh staging              # forward localhost:5433 -> staging RDS
#   db-tunnel.sh staging 5555         # choose the local port
#   db-tunnel.sh staging --print-dsn  # print connection details and exit
#
# Requires the AWS Session Manager plugin:
#   brew install --cask session-manager-plugin
#
# Runs in the foreground and holds the tunnel open until Ctrl-C.
#
# Ctrl-C is enough: the plugin terminates the session on SIGINT and it leaves
# describe-sessions immediately.
#
# KILLING THE PROCESS IS NOT. On SIGTERM — pkill, kill <pid>, a wrapper cleaning
# up after itself — the local port closes but the session stays Active on the
# AWS side until the 20-minute idle timeout, leaving a route to the database
# with no terminal attached. Same for a closed window or a suspended laptop.
# Both were verified by signalling the plugin directly.
#
#   aws ssm describe-sessions --state Active \
#     --query 'Sessions[].SessionId' --output text
#   aws ssm terminate-session --session-id <id>
#
# Covering the SIGTERM case automatically needs a trap, which needs the session
# id, which this script cannot see while it exec's the CLI. Tracked in the
# backlog; the interactive path does not need it.
#
# What gets recorded: CloudTrail logs the StartSession call with the IAM
# principal, the target instance and the document name. The SQL itself is NOT
# recorded anywhere — a forwarded port carries no terminal output, so Session
# Manager never sees the queries, and /aws/ssm/nahuat-sessions stays empty for
# tunnels. It captures interactive shells on the bastion, which is a different
# thing.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "Usage: $0 <staging|production> [local_port] [--print-dsn]" >&2
  exit 1
}

env_name="${1:-}"
case "$env_name" in
  staging | production) : ;;
  *) usage ;;
esac
shift

local_port=5433
print_dsn=false
while [ $# -gt 0 ]; do
  case "$1" in
    --print-dsn) print_dsn=true ;;
    [0-9]*) local_port="$1" ;;
    *) usage ;;
  esac
  shift
done

TF_DIR="$SCRIPT_DIR/../terraform/environments/$env_name/application"

if [ ! -d "$TF_DIR" ]; then
  echo "No application layer at $TF_DIR" >&2
  exit 1
fi

# Read the target from Terraform state rather than taking it on the command
# line. A hostname typed by hand is how someone ends up tunnelled into
# production while believing they are in staging.
echo "Reading $env_name outputs..." >&2
outputs="$(terraform -chdir="$TF_DIR" output -json)"

instance_id="$(echo "$outputs" | jq -r '.bastion_instance_id.value // empty')"
rds_endpoint="$(echo "$outputs" | jq -r '.rds_endpoint.value // empty')"
rds_port="$(echo "$outputs" | jq -r '.rds_port.value // 5432')"
db_secret_arn="$(echo "$outputs" | jq -r '.db_secret_arn.value // empty')"
db_name="$(echo "$outputs" | jq -r '.rds_db_name.value // "nahuat"')"

if [ -z "$rds_endpoint" ]; then
  echo "No rds_endpoint output — is the $env_name application layer up?" >&2
  exit 1
fi

if [ -z "$instance_id" ]; then
  echo "No bastion in $env_name." >&2
  echo "" >&2
  echo "Both environments set enable_bastion = true, so this usually means the" >&2
  echo "application layer is torn down rather than that a bastion was withheld." >&2
  echo "Bring $env_name up, or set enable_bastion = true and apply." >&2
  exit 1
fi

# The password lives in the AWS-managed RDS secret. Fetched here so it is never
# stored anywhere on disk; the bastion itself cannot read it, deliberately —
# reaching the host and being able to log in are two separate permissions.
if [ -n "$db_secret_arn" ]; then
  secret_json="$(aws secretsmanager get-secret-value \
    --secret-id "$db_secret_arn" --query SecretString --output text 2>/dev/null || true)"
  db_user="$(echo "${secret_json:-}" | jq -r '.username // "postgres"' 2>/dev/null || echo postgres)"
  db_pass="$(echo "${secret_json:-}" | jq -r '.password // empty' 2>/dev/null || true)"
else
  db_user=postgres
  db_pass=""
fi

cat >&2 <<INFO

  Environment   $env_name
  Database      $rds_endpoint:$rds_port
  Through       $instance_id
  Local         localhost:$local_port
  User          $db_user

INFO

if [ "$print_dsn" = true ]; then
  # Percent-encoded through jq's @uri, and not cosmetically. The RDS-managed
  # password contains URL-special characters, and interpolating it raw produced
  # a string psql accepts — it does not parse this as a URL — while Node's URL
  # parser rejects it outright. A Prisma client handed that DSN fails with
  # `Invalid URL` and a stack trace pointing at the query, naming nothing that
  # would lead anyone here.
  #
  # sslmode=require, not the no-verify that buildDatabaseUrl() uses: `no-verify`
  # is a node-postgres spelling that libpq does not accept, and this DSN's first
  # audience is psql. `require` encrypts without checking the certificate name,
  # which is what a forwarded port needs — the certificate names the RDS
  # endpoint, never the localhost presented here.
  enc_user="$(jq -rn --arg v "$db_user" '$v|@uri')"

  if [ -n "$db_pass" ]; then
    enc_pass="$(jq -rn --arg v "$db_pass" '$v|@uri')"
    echo "postgresql://$enc_user:$enc_pass@localhost:$local_port/$db_name?sslmode=require"
  else
    echo "postgresql://$enc_user@localhost:$local_port/$db_name?sslmode=require"
  fi
  exit 0
fi

echo "  psql \"postgresql://$db_user@localhost:$local_port/$db_name\"" >&2
echo "  Password: --print-dsn, or read the secret in the console" >&2
echo "" >&2
echo "Ctrl-C to close the tunnel." >&2
echo "" >&2

# AWS-StartPortForwardingSessionToRemoteHost, not the plain port-forwarding
# document: the target is RDS, not the bastion. The bastion listens on nothing
# and only relays.
exec aws ssm start-session \
  --target "$instance_id" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$rds_endpoint\"],\"portNumber\":[\"$rds_port\"],\"localPortNumber\":[\"$local_port\"]}"

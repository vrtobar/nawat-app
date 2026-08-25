# =============================================================================
# GLOBAL — SESSION MANAGER PREFERENCES
#
# Session logging for every SSM session in this account, in either environment.
#
# WHY THIS IS IN THE GLOBAL LAYER AND NOT PER-ENVIRONMENT. Session Manager
# reads its preferences from an SSM document with the fixed, reserved name
# SSM-SessionManagerRunShell. There is exactly one per account and region — the
# name is not ours to choose or namespace. If both foundations declared it they
# would own the same physical resource from two state files and overwrite each
# other on every apply, with the last one to run deciding where sessions log.
# So it lives here with the hosted zone, the ECR repositories and the OIDC
# provider: created once, shared, never destroyed.
#
# The consequence worth knowing: this is one setting for the whole account.
# Turning logging off for staging would turn it off for production too.
#
# WHAT THIS DOES AND DOES NOT CAPTURE — verified on staging 2026-08-25, because
# the answer is not what it looks like. This document governs Standard_Stream
# sessions, meaning interactive shells. A PORT FORWARDING session produces no
# CloudWatch transcript at all: nothing is typed on the host and nothing is
# returned by it, so there is no stream to capture. A tunnel to RDS therefore
# leaves NOTHING in this log group. Confirmed by opening one and finding the
# group empty.
#
# So the audit trail for database tunnels is CloudTrail, not this: StartSession
# records the IAM principal, the target instance and the document name, which
# answers who connected to what and when — but never what they ran, because SSM
# never sees it. The queries happen on the developer's machine and reach
# Postgres over a forwarded socket.
#
# This document still earns its place: anyone who opens a real shell on the
# bastion — `aws ssm start-session --target <id>` with no document — is
# recorded here in full. That is the case worth catching, since a shell on a
# host inside the VPC is a different thing from a forwarded port.
# =============================================================================

# Sessions outlive the environments they connect to — the point of an audit
# trail is that it survives the thing it describes — so this log group is here
# rather than in the disposable layer, and a staging teardown does not take the
# record of what was done with it.
resource "aws_cloudwatch_log_group" "ssm_sessions" {
  name              = "/aws/ssm/nahuat-sessions"
  retention_in_days = 90

  tags = { Name = "nahuat-ssm-sessions" }
}

# One group for both environments rather than one each. The stream name carries
# the target instance id, and the instances are named nahuat-staging-bastion and
# nahuat-production-bastion, so the environment is never ambiguous — while a
# single group means a query that asks "who touched a database" cannot miss one
# by looking in the wrong place.
resource "aws_ssm_document" "session_preferences" {
  name            = "SSM-SessionManagerRunShell"
  document_type   = "Session"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "1.0"
    description   = "Session Manager preferences for nahuat - CloudWatch logging required"
    sessionType   = "Standard_Stream"
    inputs = {
      cloudWatchLogGroupName = aws_cloudwatch_log_group.ssm_sessions.name

      # Stream to CloudWatch as the session runs, rather than uploading once it
      # ends. A session killed by a dropped laptop lid or an expired token still
      # leaves its transcript; the batch path would lose exactly the sessions
      # most worth having a record of.
      cloudWatchStreamingEnabled = true

      # KMS encryption of the transcripts, off. Turning it on requires the log
      # group to be KMS-encrypted with a customer managed key and makes SSM
      # refuse to start a session when it is not — a useful property, but it
      # needs a key, a key policy and the rotation that comes with them.
      # CloudWatch still encrypts at rest under an AWS-managed key; what is
      # given up is control of that key, not encryption.
      #
      # Worth revisiting when production carries real user data: a shell
      # transcript can contain anything that was typed or returned, which is a
      # different sensitivity from ordinary logs.
      cloudWatchEncryptionEnabled = false

      # No run-as user: sessions land as ssm-user, the agent's default. Mapping
      # to a named POSIX account would make the transcript attributable at the
      # OS level, but attribution already exists where it matters — CloudTrail
      # records the IAM principal that called StartSession, and that is the
      # identity worth having.
      runAsEnabled = false

      # Minutes. A forwarding session left open on a closed laptop otherwise
      # holds a route to the database indefinitely.
      idleSessionTimeout = "20"
    }
  })

  tags = { Name = "nahuat-session-preferences" }
}

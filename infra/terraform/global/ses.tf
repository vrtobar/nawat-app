# =============================================================================
# SES — DOMAIN IDENTITY AND SENDING
#
# Scope: outbound only. This is what Auth0 needs to send Magic Link emails
# from noreply@nahuat.com via custom SMTP.
#
# Inbound (MX on the apex, receipt rules, the email S3 bucket, and the
# forwarder Lambda for victor@nahuat.com) is deliberately not here — it
# depends on a deployable Lambda artifact, so it belongs with the other
# Lambda consumers once their packaging is settled.
#
# Uses the SESv2 resources rather than aws_ses_domain_identity +
# aws_ses_domain_dkim: under SESv2 the three DKIM CNAMEs satisfy both domain
# verification and DKIM signing, so the separate _amazonses TXT verification
# record the v1 flow requires is unnecessary.
# =============================================================================

# Easy DKIM: AWS generates and rotates the signing keys. The alternative
# (BYODKIM, via dkim_signing_attributes.domain_signing_private_key) would put
# a private key in Terraform state.
resource "aws_sesv2_email_identity" "nahuat" {
  email_identity = "nahuat.com"
}

# Three CNAMEs proving domain ownership and enabling DKIM signatures.
# Verification flips to SUCCESS on its own once these resolve — usually
# minutes, since the zone is already authoritative for nahuat.com.
resource "aws_route53_record" "ses_dkim" {
  count = 3

  zone_id = aws_route53_zone.nahuat.zone_id
  name    = "${aws_sesv2_email_identity.nahuat.dkim_signing_attributes[0].tokens[count.index]}._domainkey.nahuat.com"
  type    = "CNAME"
  ttl     = 300
  records = [
    "${aws_sesv2_email_identity.nahuat.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com",
  ]
}

# -----------------------------------------------------------------------------
# Custom MAIL FROM
#
# Without this the envelope sender is amazonses.com, so SPF authenticates a
# domain the recipient never sees and DMARC has only DKIM to align against.
# Pointing the envelope at mail.nahuat.com aligns both mechanisms, which is
# worth the two extra records for auth email that must not land in spam.
# -----------------------------------------------------------------------------
resource "aws_sesv2_email_identity_mail_from_attributes" "nahuat" {
  email_identity   = aws_sesv2_email_identity.nahuat.email_identity
  mail_from_domain = "mail.nahuat.com"

  # Fall back to amazonses.com if the MX below ever fails to resolve.
  # REJECT_MESSAGE is stricter, but these carry Magic Links: a DNS problem
  # should degrade authentication, not lock every user out of signing in.
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# SES requires an MX on the MAIL FROM subdomain to receive bounce and
# complaint notifications. Region-specific endpoint.
resource "aws_route53_record" "ses_mail_from_mx" {
  zone_id = aws_route53_zone.nahuat.zone_id
  name    = "mail.nahuat.com"
  type    = "MX"
  ttl     = 300
  records = ["10 feedback-smtp.us-east-1.amazonses.com"]
}

# SPF for the envelope domain — this is the record SPF actually checks now
# that MAIL FROM is custom.
resource "aws_route53_record" "ses_mail_from_spf" {
  zone_id = aws_route53_zone.nahuat.zone_id
  name    = "mail.nahuat.com"
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com ~all"]
}

# SPF on the apex. Not consulted for SES sending while custom MAIL FROM is
# in effect, but published so anything sending with an @nahuat.com envelope
# is covered. ~all (softfail) rather than -all: a hard fail risks discarding
# legitimate mail from a sender not yet listed here.
resource "aws_route53_record" "spf" {
  zone_id = aws_route53_zone.nahuat.zone_id
  name    = "nahuat.com"
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com ~all"]
}

# -----------------------------------------------------------------------------
# DMARC
#
# p=none is monitor-only: it asks receivers to report on failures without
# acting on them. Correct starting posture — tightening to quarantine or
# reject before seeing real report data risks silently dropping legitimate
# mail. Revisit once aggregate reports have been arriving for a few weeks.
# -----------------------------------------------------------------------------
resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.nahuat.zone_id
  name    = "_dmarc.nahuat.com"
  type    = "TXT"
  ttl     = 300
  records = ["v=DMARC1; p=none; rua=mailto:${var.dmarc_report_email}"]
}

# TODO: an SES configuration set would publish bounce and complaint events to
# SNS or CloudWatch, which is how sender reputation gets monitored before AWS
# acts on it. Account-level metrics in the SES console cover the early period.

# =============================================================================
# MODULE: SSM BASTION
#
# A t4g.nano in a private subnet whose only purpose is to be a TCP endpoint
# that Session Manager can port-forward through, so a human with AWS
# credentials can reach RDS from a laptop.
#
# WHY THIS EXISTS AT ALL. The database is publicly_accessible = false in
# private subnets, and ECS Exec is disabled on the services. There is no path
# from a developer machine to staging or production data — not a slow one, none.
# ECS Exec would not have fixed it either: `ecs execute-command` runs an
# interactive command inside a task, while port forwarding requires an SSM
# *managed instance*, which a Fargate task is not.
#
# WHY IT IS SAFE TO LEAVE DEFINED. It has no public IP, no key pair, no inbound
# rule, and no password. Session Manager works by the agent dialling out, so
# there is no listening port to find. Access is therefore an IAM question
# rather than a network one: whoever can call ssm:StartSession can connect, and
# nobody else can, whatever they can reach.
#
# WHERE IT LIVES. This module is instantiated from the APPLICATION layer, so it
# is destroyed by a teardown and bills only while the environment is up. Its
# security group is the exception and lives in foundation, because the RDS
# group's ingress rules are inline and therefore authoritative — a rule added
# from another layer would be reverted by the next foundation apply, and
# database access would break with nothing in the application diff to explain
# it. Same split as the ECS services: group in foundation, workload here.
# =============================================================================

# AL2023 ships and enables the SSM agent, so nothing has to be installed and
# there is no user_data. arm64 to match t4g and ADR 6.
#
# Resolved from the public SSM parameter rather than pinned: this instance is
# cattle in the strongest sense — it holds no state, and a session opens a
# fresh shell — so tracking the current patched image beats reproducibility
# here. It does mean `terraform plan` can show a replacement after AWS
# publishes a new AMI; that replacement is free of consequence, but see
# ignore_changes below for why it does not happen mid-session.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

# -----------------------------------------------------------------------------
# IAM
#
# AmazonSSMManagedInstanceCore and nothing else. It is what lets the agent
# register and carry a session; it grants no access to application data.
#
# Deliberately NOT granted: any database credential. The tunnel forwards a TCP
# port, so authentication happens on the developer's own machine with a
# password they fetched themselves. An instance that could read the RDS secret
# would turn ssm:StartSession into database access; keeping them separate means
# reaching the bastion and being able to log into the database stay two
# different permissions.
# -----------------------------------------------------------------------------
resource "aws_iam_role" "bastion" {
  name = "${var.prefix}-bastion"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "${var.prefix}-bastion" }
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "${var.prefix}-bastion"
  role = aws_iam_role.bastion.name
}

# -----------------------------------------------------------------------------
# INSTANCE
# -----------------------------------------------------------------------------
resource "aws_instance" "bastion" {
  ami           = data.aws_ssm_parameter.al2023.value
  instance_type = var.instance_type

  # First private subnet, not spread across them. One instance cannot be
  # multi-AZ, and a bastion has no availability requirement: if the AZ holding
  # it fails, the answer is to apply again, not to pay for a standby.
  subnet_id              = var.private_subnet_ids[0]
  vpc_security_group_ids = [var.bastion_sg_id]
  iam_instance_profile   = aws_iam_instance_profile.bastion.name

  # Explicit rather than relying on the subnet default. A public IP on this
  # instance would not open a port — there are no ingress rules — but it would
  # make it reachable enough to appear in internet-wide scans, and the whole
  # argument for SSM over a jump host is that there is nothing out there to find.
  associate_public_ip_address = false

  # IMDSv2 required. The instance profile's credentials are retrievable from
  # the metadata service, and IMDSv1's unauthenticated GET is what makes SSRF
  # on a host into credential theft. hop_limit 1 keeps them off the container
  # network if anything is ever run here in Docker.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_size           = 8
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  # A new AL2023 release must not replace this instance underneath a session
  # that is currently forwarding a port. The AMI is re-read on every plan, so
  # without this an unrelated apply — bringing the environment up, deploying —
  # could destroy the host mid-connection. Replacing it deliberately is
  # `terraform taint` plus apply, or simply a teardown and bring-up, which is
  # how this environment gets its patched image in practice.
  lifecycle {
    ignore_changes = [ami]
  }

  tags = {
    Name    = "${var.prefix}-bastion"
    Purpose = "SSM port forwarding to RDS - no ingress, no key pair"
  }
}

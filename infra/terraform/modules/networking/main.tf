# =============================================================================
# MODULE: NETWORKING
# VPC, subnets, egress path, and the free S3 gateway endpoint.
# =============================================================================

# enable_dns_hostnames is required for RDS to hand out a resolvable endpoint
# hostname; without it the instance is only reachable by IP.
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${var.prefix}-vpc" }
}

# -----------------------------------------------------------------------------
# Subnets
#
# Both AZs are always created even under single_az_mode: ALB registration, RDS
# subnet groups, and ElastiCache subnet groups all require two AZs regardless
# of where compute actually runs.
#
# map_public_ip_on_launch stays false on the public subnets — the ALB gets its
# public address from AWS directly, and nothing else there should be reachable.
# -----------------------------------------------------------------------------

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_a_cidr
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = false

  tags = { Name = "${var.prefix}-public-a" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_b_cidr
  availability_zone       = "${var.region}b"
  map_public_ip_on_launch = false

  tags = { Name = "${var.prefix}-public-b" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_a_cidr
  availability_zone = "${var.region}a"

  tags = { Name = "${var.prefix}-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_b_cidr
  availability_zone = "${var.region}b"

  tags = { Name = "${var.prefix}-private-b" }
}

# -----------------------------------------------------------------------------
# Default security group — locked shut
#
# AWS creates one per VPC allowing unrestricted traffic between any resources
# that land in it, and anything created without an explicit security group
# silently inherits it. Terraform cannot delete it, so this resource adopts it
# and strips every rule: an accidental omission then fails closed instead of
# quietly getting open access.
# -----------------------------------------------------------------------------
resource "aws_default_security_group" "locked" {
  vpc_id = aws_vpc.main.id

  # No ingress or egress blocks — this revokes all default rules.

  tags = { Name = "${var.prefix}-default-DO-NOT-USE" }
}

# One per VPC, and the exit point for both public subnet traffic and the NAT
# gateway's own upstream traffic.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${var.prefix}-igw" }
}

# -----------------------------------------------------------------------------
# NAT egress is NOT here — see modules/nat, called from the application layer.
#
# A NAT gateway costs ~$32/month and only earns it while compute is running,
# but this layer is never destroyed. Leaving it here meant staging paid for a
# gateway routing traffic for zero tasks the entire time its application layer
# was torn down. The gateway and its default route now live in the application
# layer, so tearing that down takes the cost with it.
#
# What stays here is the route tables themselves, so their IDs are stable and
# the subnet associations never churn. The application layer adds an aws_route
# for 0.0.0.0/0 into them; when it is destroyed the route disappears and the
# private subnets lose egress, which is correct because nothing is running.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Routing
# -----------------------------------------------------------------------------

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.prefix}-rt-public" }
}

# Always two, one per AZ, regardless of how many NAT gateways the application
# layer ends up creating. Route tables are free, and fixing the count here
# means the application layer can go from one NAT to two without foundation
# changing — index 0 serves AZ-a, index 1 serves AZ-b, and with a single NAT
# both simply point at it.
#
# No route attribute: the default route is added by the application layer as a
# standalone aws_route. The provider treats route as optional+computed, so
# omitting it leaves externally-managed routes alone instead of reconciling
# them away. Do not add an inline route block here — mixing the two styles
# makes them fight over the same table.
resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.main.id

  tags = { Name = "${var.prefix}-rt-private-${count.index + 1}" }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private[0].id
}

resource "aws_route_table_association" "private_b" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private[1].id
}

# -----------------------------------------------------------------------------
# S3 Gateway endpoint — free
#
# Without it, every S3 call from a private subnet (presigned uploads, asset
# reads) traverses the NAT gateway and pays its per-GB processing charge.
# Gateway endpoints add a route rather than an ENI, so there is no hourly cost
# and no reason not to have one.
# -----------------------------------------------------------------------------
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = { Name = "${var.prefix}-vpce-s3" }
}

# -----------------------------------------------------------------------------
# Interface endpoints — optional, ~$7/month each
#
# Keeps Secrets Manager and CloudWatch Logs traffic off the NAT gateway and
# inside the AWS network. Off by default: at this traffic volume the NAT
# processing charges they avoid are smaller than their hourly cost.
#
# private_dns_enabled lets the SDKs keep using their standard endpoint URLs
# rather than needing per-service endpoint overrides in application config.
# -----------------------------------------------------------------------------

resource "aws_security_group" "vpc_endpoints" {
  count       = var.enable_vpc_endpoints ? 1 : 0
  name        = "${var.prefix}-vpce"
  description = "Interface VPC endpoints - HTTPS from within the VPC"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.prefix}-vpce" }
}

resource "aws_vpc_endpoint" "secretsmanager" {
  count               = var.enable_vpc_endpoints ? 1 : 0
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = { Name = "${var.prefix}-vpce-secretsmanager" }
}

resource "aws_vpc_endpoint" "cloudwatch_logs" {
  count               = var.enable_vpc_endpoints ? 1 : 0
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = { Name = "${var.prefix}-vpce-cloudwatch-logs" }
}

# =============================================================================
# MODULE: NAT
#
# Lives in the application layer, not foundation, so that destroying the
# application layer takes the ~$32/month gateway with it. Staging spends most
# of its life torn down; leaving the gateway in the always-on layer meant
# paying to route traffic for zero running tasks.
#
# Foundation owns the private route tables. This module only writes the
# default route into them, so the tables and their subnet associations keep
# stable IDs across teardown cycles.
# =============================================================================

# The Elastic IP is the address private resources present to the internet on
# outbound calls: Auth0 token verification from ECS, and the CloudFront API
# from cdn-invalidation-consumer.
resource "aws_eip" "nat" {
  count  = var.nat_gateway_count
  domain = "vpc"

  tags = { Name = "${var.prefix}-nat-eip-${count.index + 1}" }
}

# Placed in a public subnet because the gateway needs its own route out.
resource "aws_nat_gateway" "main" {
  count         = var.nat_gateway_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = var.public_subnet_ids[count.index]

  tags = { Name = "${var.prefix}-nat-${count.index + 1}" }
}

# One default route per private route table. With a single gateway both AZs
# point at it, which means AZ-b egress crosses an AZ boundary and incurs
# transfer charges — the accepted cost of running one gateway instead of two.
# With two, each AZ routes through the gateway in its own AZ.
resource "aws_route" "private_nat" {
  count = length(var.private_route_table_ids)

  route_table_id         = var.private_route_table_ids[count.index]
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id = aws_nat_gateway.main[
    min(count.index, var.nat_gateway_count - 1)
  ].id
}

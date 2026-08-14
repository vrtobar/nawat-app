# Architecture decision records

Short documents recording decisions that were not obvious, together with what
was rejected and why. They exist so a decision can be re-argued later against
the reasoning that produced it, rather than rediscovered.

An ADR is written when a choice has consequences a reader would otherwise have
to reverse-engineer from the code — particularly security boundaries, and
places where two systems share ownership of one resource. Routine choices do
not get one.

They are not updated as the code changes. A decision that is superseded gets a
new record and the old one is marked as such, so the history stays readable.

Records 3 through 8 were written after the fact, from the code and from the
decisions' own history. They carry the date of the decision alongside the date
of the record.

| #                                                 | Title                                                | Status   |
| ------------------------------------------------- | ---------------------------------------------------- | -------- |
| [1](0001-ci-iam-boundaries.md)                    | CI/CD IAM boundaries                                 | Accepted |
| [2](0002-immutable-image-tags.md)                 | Immutable image tags, and who owns a task definition | Accepted |
| [3](0003-terraform-layer-split.md)                | Three Terraform layers, split by destroy safety      | Accepted |
| [4](0004-cloudfront-origin-and-failover.md)       | CloudFront origin, TLS, and the maintenance page     | Accepted |
| [5](0005-auth0-tenant-separation.md)              | One Auth0 tenant per environment                     | Accepted |
| [6](0006-arm64-everywhere.md)                     | ARM64 (Graviton) across the whole stack              | Accepted |
| [7](0007-database-connectivity-and-migrations.md) | Database connectivity and migration execution        | Accepted |
| [8](0008-rest-resource-shape.md)                  | Shallow-nested REST resources                        | Accepted |

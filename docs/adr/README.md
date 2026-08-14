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

| # | Title | Status |
| --- | --- | --- |
| [1](0001-ci-iam-boundaries.md) | CI/CD IAM boundaries | Accepted |
| [2](0002-immutable-image-tags.md) | Immutable image tags, and who owns a task definition | Accepted |
